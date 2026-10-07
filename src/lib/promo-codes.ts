/**
 * P2→P1: Серверная истина по промокодам + единый справочник для клиента.
 *
 * Источники (в порядке приоритета):
 *   1. Таблица promo_codes (реальная схема: type percent|fixed|free_delivery,
 *      value, min_order_amount, max_uses/used_count, valid_from/valid_to, is_active).
 *   2. STATIC_PROMO_CODES — статический справочник, импортируется И клиентом
 *      (store.applyPromo — оптимистичная оценка скидки), И сервером
 *      (checkout fallback, если БД недоступна/запись не найдена).
 *
 * Безопасность:
 *   • supabaseAdmin импортируется ЛЕНИВО (внутри функций) — модуль можно
 *     импортировать в клиентский бандл без утечки SERVICE_ROLE и без
 *     выполнения админ-инициализации на клиенте;
 *   • инкремент used_count — SQL UPDATE expression, гонки не создают дублей.
 *
 * ВАЖНО: скидка в РУБЛЯХ (orders.discount — рубли, как и products.price).
 */
import type { NextRequest } from "next/server";

// ===== Статический справочник (клиент + сервер) =====

export interface StaticPromoCode {
  type: "percent" | "fixed";
  /** percent: целые проценты (10 = 10%); fixed: рубли */
  value: number;
  description?: string;
}

/**
 * Статические промокоды — единая точка истины для клиента и сервера.
 * Перенесено из store.ts (PROMO_CODES); BIRTHDAY25 добавлен по факту БД,
 * BIRTHDAY оставлен как совместимый алиас.
 */
export const STATIC_PROMO_CODES: Record<string, StaticPromoCode> = {
  WELCOME10: { type: "percent", value: 10, description: "Приветственный — 10%" },
  SWEET15: { type: "percent", value: 15, description: "Скидка 15%" },
  UYEZD20: { type: "percent", value: 20, description: "Скидка 20%" },
  BIRTHDAY25: { type: "percent", value: 25, description: "День рождения — 25%" },
  BIRTHDAY: { type: "percent", value: 25, description: "День рождения — 25% (алиас)" },
};

export interface ValidatePromoCodeParams {
  code: string;
  userId: string;
  userRoles: string[];
  orderAmount: number; // сумма товаров без доставки, рубли
  confectionerId?: string | null;
}

export interface ValidatePromoCodeResult {
  valid: boolean;
  reason?: string;
  promoCodeId?: string;
  discountRub?: number;
  discountType?: "percent" | "fixed" | "free_delivery";
  discountValue?: number;
  /** true — промокод отменяет стоимость доставки (delivery_cost = 0). */
  freeDelivery?: boolean;
}

// ===== Ленивый admin-клиент (только сервер) =====

async function getAdmin() {
  if (typeof window !== "undefined") return null; // клиент — только статика
  try {
    const mod = await import("./supabase/admin");
    return mod.supabaseAdmin;
  } catch {
    return null;
  }
}

/** Ошибка «таблицы нет» — sigil, чтобы отдать статический fallback вместо отказа. */
function isMissingRelation(err: { message?: string; code?: string }): boolean {
  return err?.code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

// ===== Валидация =====

/**
 * Валидировать промокод и вернуть сумму скидки (рубли, целое).
 * НЕ инкрементит used_count — это делает applyPromoCodeToOrder().
 */
export async function validatePromoCode(
  params: ValidatePromoCodeParams
): Promise<ValidatePromoCodeResult> {
  const code = String(params.code || "").trim().toUpperCase();

  if (!code) {
    return { valid: false, reason: "Пустой промокод" };
  }
  if (params.orderAmount < 0 || !Number.isFinite(params.orderAmount)) {
    return { valid: false, reason: "Невалидная сумма заказа" };
  }

  // 1. БД (реальная схема promo_codes). Ошибка схемы/БД → статический fallback.
  const admin = await getAdmin();
  if (admin) {
    const { data: promo, error } = await admin
      .from("promo_codes")
      .select(
        `id, code, type, value, min_order_amount, max_uses, used_count,
         valid_from, valid_to, is_active`
      )
      .eq("code", code)
      .maybeSingle();

    if (error) {
      if (!isMissingRelation(error)) {
        console.error("[promo-codes] lookup error:", error.message);
        // БД есть, но недоступна — не блокируем checkout из-за промокода,
        // если код известен статически (иначе честный отказ).
        return staticValidate(code, params);
      }
    } else if (promo && promo.is_active) {
      const now = new Date();
      const from = promo.valid_from ? new Date(promo.valid_from) : null;
      const to = promo.valid_to ? new Date(promo.valid_to) : null;
      if (from && now < from) {
        return { valid: false, reason: "Промокод ещё не активен" };
      }
      if (to && now > to) {
        return { valid: false, reason: "Срок действия промокода истёк" };
      }
      if (promo.max_uses !== null && promo.max_uses !== undefined && (promo.used_count || 0) >= promo.max_uses) {
        return { valid: false, reason: "Лимит использований промокода исчерпан" };
      }
      if (params.orderAmount < (promo.min_order_amount || 0)) {
        return {
          valid: false,
          reason: `Минимальная сумма заказа для этого промокода — ${promo.min_order_amount}₽`,
        };
      }

      const type = promo.type as ValidatePromoCodeResult["discountType"];
      let discountRub = 0;
      let freeDelivery = false;
      if (type === "percent") {
        discountRub = Math.round((params.orderAmount * Number(promo.value || 0)) / 100);
      } else if (type === "fixed") {
        discountRub = Math.round(Number(promo.value || 0));
      } else if (type === "free_delivery") {
        freeDelivery = true;
      } else {
        return { valid: false, reason: "Неизвестный тип промокода" };
      }

      // Скидка не может превышать сумму заказа
      discountRub = Math.max(0, Math.min(discountRub, Math.round(params.orderAmount)));

      return {
        valid: true,
        promoCodeId: promo.id,
        discountRub,
        discountType: type,
        discountValue: Number(promo.value || 0),
        freeDelivery,
      };
    }
  }

  // 2. Строки в БД нет (или БД недоступна) — статический справочник
  return staticValidate(code, params);
}

/** Статическая валидация: только percent/fixed из STATIC_PROMO_CODES. */
function staticValidate(code: string, params: ValidatePromoCodeParams): ValidatePromoCodeResult {
  const statik = STATIC_PROMO_CODES[code];
  if (!statik) {
    return { valid: false, reason: "Промокод не найден или деактивирован" };
  }
  let discountRub = 0;
  if (statik.type === "percent") {
    discountRub = Math.round((params.orderAmount * statik.value) / 100);
  } else {
    discountRub = Math.round(statik.value);
  }
  discountRub = Math.max(0, Math.min(discountRub, Math.round(params.orderAmount)));
  return {
    valid: true,
    discountRub,
    discountType: statik.type,
    discountValue: statik.value,
    freeDelivery: false,
  };
}

// ===== Применение к заказу =====

/**
 * Привязать промокод к заказу (реальные колонки orders: promo_code,
 * promo_discount) и инкрементить used_count. Best-effort: ошибки логируются,
 * заказ не откатываем (счётчик корректируется ревизией).
 */
export async function applyPromoCodeToOrder(args: {
  code: string;
  promoCodeId?: string | null;
  orderId: string;
  discountRub: number;
}): Promise<void> {
  const admin = await getAdmin();
  if (!admin) return;

  const { error: orderErr } = await admin
    .from("orders")
    .update({
      promo_code: args.code.toUpperCase(),
      promo_discount: Math.max(0, Math.round(args.discountRub)),
    })
    .eq("id", args.orderId);
  if (orderErr) {
    console.error("[promo-codes] link to order failed:", orderErr.message);
  }

  // Инкремент счётчика: по id (если строка из БД), иначе по коду
  if (args.promoCodeId) {
    const { error: incErr } = await admin.rpc("increment_promo_used_count", {
      p_promo_id: args.promoCodeId,
    });
    if (incErr) {
      // Fallback на прямой UPDATE expression (нет race condition на SQL-уровне)
      const { error: updErr } = await admin
        .from("promo_codes")
        .update({ used_count: (await currentUsedCount(args.promoCodeId)) + 1 })
        .eq("id", args.promoCodeId);
      if (updErr) console.warn("[promo-codes] used_count increment failed:", updErr.message);
    }
  }
}

async function currentUsedCount(promoId: string): Promise<number> {
  const admin = await getAdmin();
  if (!admin) return 0;
  const { data } = await admin
    .from("promo_codes")
    .select("used_count")
    .eq("id", promoId)
    .maybeSingle();
  return (data as { used_count?: number } | null)?.used_count || 0;
}

/** Откатить применение промокода (отмена заказа) — уменьшить used_count. */
export async function revertPromoCodeUsage(promoCodeId: string): Promise<void> {
  const admin = await getAdmin();
  if (!admin) return;
  const { error: decErr } = await admin.rpc("decrement_promo_used_count", {
    p_promo_id: promoCodeId,
  });
  if (decErr) {
    const cur = await currentUsedCount(promoCodeId);
    await admin
      .from("promo_codes")
      .update({ used_count: Math.max(0, cur - 1) })
      .eq("id", promoCodeId);
  }
}

// ===== Утилиты для клиентов API =====

/** Нормализовать промокод из тела запроса (checkout): строка 1..40 символов или undefined. */
export function normalizePromoCodeInput(
  raw: unknown
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const code = raw.trim().toUpperCase().slice(0, 40);
  return code.length > 0 ? code : undefined;
}

/**
 * Извлечь Idempotency-Key из заголовков запроса checkout.
 * Валидный ключ: 8..100 символов из [A-Za-z0-9._-]. Иначе undefined.
 */
export function extractIdempotencyKey(request: NextRequest): string | undefined {
  const raw = request.headers.get("idempotency-key") || request.headers.get("Idempotency-Key");
  if (!raw) return undefined;
  const key = raw.trim();
  if (key.length < 8 || key.length > 100) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return undefined;
  return key;
}
