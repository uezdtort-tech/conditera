/**
 * negotiation-binding.ts — Z-v32 Этап 8 (PR-5): серверная фиксация согласованной
 * цены индивидуального предложения при оформлении заказа.
 *
 * Единицы (закреплено инветигацией PR-5):
 *   • negotiations.quoted_price / quoted_delivery_cost — КОПЕЙКИ (0004;
 *     клиент use-real-inquiries.ts шлёт Math.round(rub * 100));
 *   • order_items.unit_price / orders.subtotal / total — РУБЛИ
 *     (см. комментарий в /api/checkout: "рубли (НЕ копейки)").
 *
 * Гарантии:
 *   • цена в заказ ВСЕГДА приходит из записи negotiations на сервере —
 *     тело запроса клиента на цену не влияет (в CheckoutSchema цены нет);
 *   • истёкшее предложение нельзя принять (роут -> 410 OFFER_EXPIRED,
 *     триггер 0085 — бэкстоп на уровне БД);
 *   • binding-запись в metadata.offerBinding — аудит согласования.
 */

/** Документированный дефолт срока действия предложения (дней). */
export const OFFER_VALIDITY_DEFAULT_DAYS = 14;
/** Верхняя граница custom-срока кондитера (дней) — клампится сервером. */
export const OFFER_VALIDITY_MAX_DAYS = 60;
export const OFFER_VALIDITY_MIN_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Нормализация custom-срока от кондитера: default 14 дней, кламп 1..60.
 * Нечисловое/некорректное значение → дефолт (fail-safe, не fail-closed:
 * срок — не деньги, отказ отправки предложения из-за опечатки в days вреден).
 */
export function clampOfferValidityDays(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return OFFER_VALIDITY_DEFAULT_DAYS;
  return Math.min(
    OFFER_VALIDITY_MAX_DAYS,
    Math.max(OFFER_VALIDITY_MIN_DAYS, Math.round(n))
  );
}

/** valid_until из момента отправки предложения: now + clampOfferValidityDays. */
export function offerValidUntilFrom(now: Date, rawDays?: unknown): Date {
  return new Date(now.getTime() + clampOfferValidityDays(rawDays) * DAY_MS);
}

/** Копейки → рубли (серверный конверт, единственная точка конверсии binding). */
export function kopecksToRubles(kopecks: number): number {
  return Math.round(kopecks) / 100;
}

/** Минимальная форма negotiations-строки, нужная для binding-решения. */
export interface NegotiationRecord {
  id: string;
  user_id: string;
  status: string | null;
  quoted_price: number | null;
  quoted_delivery_cost: number | null;
  valid_until: string | Date | null;
  /**
   * ZV33-4b D1: заказ, уже оформленный по этому предложению (0004).
   * NOT NULL → повторный checkout по тем же переговорам — 409
   * OFFER_ALREADY_ORDERED (один заказ на принятое предложение).
   */
  order_id: string | null;
}

export type BindingRejection = {
  ok: false;
  httpStatus: 403 | 409 | 410 | 422;
  /** Машинный код — клиент рисует «Предложение истекло — запросите новое». */
  code:
    | "NEGOTIATION_FORBIDDEN"
    | "OFFER_NOT_ACCEPTED"
    | "OFFER_EXPIRED"
    | "OFFER_NO_PRICE"
    | "OFFER_ALREADY_ORDERED"
    | "BINDING_ITEM_AMBIGUOUS";
  message: string;
  expiredAt?: string;
};

export type BindingDecision =
  | { ok: true; negotiation: NegotiationRecord }
  | BindingRejection;

/**
 * Валидация binding переговоров к checkout (вызывается СЕРВЕРОМ по
 * negotiationId из тела; цена из тела игнорируется по построению).
 *
 * Семантика expири (документировано PR-5):
 *   • status='expired' → 410 (лениво помечен роутом при попытке принятия);
 *   • valid_until в прошлом при status='accepted' — НЕ отклонение:
 *     фиксация цены произошла в момент accept (до истечения — гарант:
 *     роут + триггер 0085), оформление после accept не отменяет сделку;
 *   • status<>'accepted' → 409: сначала явное принятие в переговорах;
 *   • order_id NOT NULL → 409 OFFER_ALREADY_ORDERED (ZV33-4b D1):
 *     ПРЕДЛОЖЕНИЕ РАСХОДУЕТСЯ ОДНИМ ЗАКАЗОМ — повторный checkout с новым
 *     Idempotency-Key больше не плодит дубли заказов по той же цене.
 */
export function validateNegotiationBinding(
  negotiation: NegotiationRecord | null | undefined,
  userId: string
): BindingDecision {
  if (!negotiation) {
    return {
      ok: false,
      httpStatus: 409,
      code: "OFFER_NOT_ACCEPTED",
      message: "Переговоры не найдены",
    };
  }
  if (negotiation.user_id !== userId) {
    return {
      ok: false,
      httpStatus: 403,
      code: "NEGOTIATION_FORBIDDEN",
      message: "Переговоры принадлежат другому пользователю",
    };
  }
  if (negotiation.status === "expired") {
    const expiredAt =
      negotiation.valid_until instanceof Date
        ? negotiation.valid_until.toISOString()
        : typeof negotiation.valid_until === "string"
          ? negotiation.valid_until
          : undefined;
    return {
      ok: false,
      httpStatus: 410,
      code: "OFFER_EXPIRED",
      message: "Предложение истекло — запросите новое",
      ...(expiredAt ? { expiredAt } : {}),
    };
  }
  if (negotiation.status !== "accepted") {
    return {
      ok: false,
      httpStatus: 409,
      code: "OFFER_NOT_ACCEPTED",
      message: "Сначала примите предложение в переговорах",
    };
  }
  // ZV33-4b D1: предложение уже расходовано заказом — второй заказ по той же
  // цене невозможен (раньше каждый новый Idempotency-Key создавал дубль).
  if (
    negotiation.order_id !== null &&
    negotiation.order_id !== undefined &&
    negotiation.order_id !== ""
  ) {
    return {
      ok: false,
      httpStatus: 409,
      code: "OFFER_ALREADY_ORDERED",
      message: "Заказ по этому предложению уже оформлен",
    };
  }
  if (negotiation.quoted_price === null || negotiation.quoted_price === undefined) {
    return {
      ok: false,
      httpStatus: 409,
      code: "OFFER_NO_PRICE",
      message: "В переговорах нет согласованной цены",
    };
  }
  return { ok: true, negotiation };
}

/** Позиция order_items, необходимая для оверрайда цены. */
export interface BindingItem {
  product_id: string | null;
  unit_price: number;
  quantity: number;
  total: number;
}

export type BindingApplication =
  | {
      ok: true;
      items: BindingItem[];
      boundItemIndex: number;
      quotedPriceKopecks: number;
      quotedPriceRub: number;
    }
  | BindingRejection;

/**
 * Применение согласованной цены к позициям заказа: оверрайд unit_price
 * ЕДИНСТВЕННОЙ custom-позиции конструктора (product_id === null) серверным
 * quoted_price (копейки → рубли). Ноль или несколько custom-позиций — 422:
 * непонятно, к чему относится согласование (честный отказ вместо догадки).
 */
export function applyNegotiationPriceBinding(
  items: BindingItem[],
  negotiation: NegotiationRecord
): BindingApplication {
  const customIndexes = items
    .map((it, idx) => (it.product_id === null ? idx : -1))
    .filter((idx) => idx >= 0);
  if (customIndexes.length !== 1) {
    return {
      ok: false,
      httpStatus: 422,
      code: "BINDING_ITEM_AMBIGUOUS",
      message:
        "Согласованная цена применяется к одной custom-позиции конструктора",
    };
  }
  const idx = customIndexes[0];
  const quotedPriceKopecks = Math.round(negotiation.quoted_price as number);
  const quotedPriceRub = kopecksToRubles(quotedPriceKopecks);
  const next = items.map((it, i) =>
    i === idx
      ? {
          ...it,
          unit_price: quotedPriceRub,
          total: quotedPriceRub * it.quantity,
        }
      : it
  );
  return {
    ok: true,
    items: next,
    boundItemIndex: idx,
    quotedPriceKopecks,
    quotedPriceRub,
  };
}

/** metadata.offerBinding — аддитивная аудит-запись согласования в orders. */
export interface OfferBindingMeta {
  negotiationId: string;
  revisionId: string | null;
  quotedPrice: number; // копейки, как в negotiations
  quotedPriceRub: number; // рубли, как в order_items.unit_price
  quotedDeliveryCost: number | null; // копейки (информационно)
  validUntil: string | null;
  boundAt: string;
}

export function buildOfferBindingMeta(args: {
  negotiation: NegotiationRecord;
  quotedPriceRub: number;
  revisionId: string | null;
  boundAt: Date;
}): OfferBindingMeta {
  const vu = args.negotiation.valid_until;
  return {
    negotiationId: args.negotiation.id,
    revisionId: args.revisionId,
    quotedPrice: Math.round(args.negotiation.quoted_price as number),
    quotedPriceRub: args.quotedPriceRub,
    quotedDeliveryCost: args.negotiation.quoted_delivery_cost ?? null,
    validUntil:
      vu instanceof Date
        ? vu.toISOString()
        : typeof vu === "string"
          ? vu
          : null,
    boundAt: args.boundAt.toISOString(),
  };
}
