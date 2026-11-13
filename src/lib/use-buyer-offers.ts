/**
 * use-buyer-offers.ts — ZV33-4 §B6–B10: реальные индивидуальные предложения
 * кондитеров для покупателя (вкладка «Предложения кондитеров» в кабинете).
 *
 * Только API (никаких прямых записей в Supabase — мёртвый путь
 * useAcceptNegotiation из use-cake-builder.ts заблокирован триггером 0085):
 *   • GET /api/inquiries (filter=own) — свои заявки + negotiations (включая
 *     quoted_price/valid_until/accepted_at/quoted_prep_time);
 *   • GET /api/confectioners — имена кондитеров (negotiations хранит только
 *     confectioner_id = auth users UUID → матчим по confectioners.userId);
 *   • GET /api/negotiations/[id] — детали + negotiation_revisions (история);
 *   • PATCH /api/negotiations/[id] { action:"accept" } — принятие предложения
 *     (410 OFFER_EXPIRED / 409 OFFER_NO_PRICE обрабатываются на UI).
 *
 * Единицы: negotiations.quoted_price/quoted_delivery_cost — КОПЕЙКИ → UI
 * показывает ₽ = /100.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

// ===== UI-модели =====

export type BuyerOfferStatus =
  | "pending" // confectioner ещё не ответил (pending_confectioner)
  | "quoted" // предложение отправлено
  | "accepted" // принято покупателем
  | "expired" // срок истёк (серверный статус)
  | "declined"
  | "counter_offered";

export interface BuyerOffer {
  negotiationId: string;
  inquiryId: string;
  confectionerId: string;
  /** businessName из GET /api/confectioners (fallback «Кондитер») */
  confectionerName: string;
  confectionerAvatar: string | null;
  /** КОПЕЙКИ (null — предложения ещё нет) */
  quotedPriceKopecks: number | null;
  /** КОПЕЙКИ (null — доставка не указана) */
  quotedDeliveryCostKopecks: number | null;
  quotedPrepTime: string | null;
  /** Сырой статус переговоров из API */
  rawStatus: string;
  status: BuyerOfferStatus;
  quotedAt: string | null;
  acceptedAt: string | null;
  /** Срок действия предложения (valid_until, ISO) */
  validUntil: string | null;
  /** Клиентское сравнение valid_until < now (серверный статус может отставать) */
  isExpired: boolean;
}

export interface BuyerInquiry {
  id: string;
  eventType: string | null;
  base: string | null;
  filling: string | null;
  coating: string | null;
  decorations: string[];
  dietary: string[];
  servings: number;
  city: string | null;
  deliveryDate: string | null;
  deliveryType: string | null;
  inscription: string | null;
  comment: string | null;
  /** рубли (estimated_price — копейки) */
  estimatedPriceRub: number | null;
  /** Сырой статус заявки: open | converted | closed | expired */
  inquiryStatus: string;
  createdAt: string;
  offers: BuyerOffer[];
}

// ===== Сырые API-строки =====

interface ApiNegotiation {
  id: string;
  inquiry_id: string;
  confectioner_id: string;
  status: string;
  quoted_price?: number | null;
  quoted_delivery_cost?: number | null;
  quoted_prep_time?: string | null;
  quoted_at?: string | null;
  accepted_at?: string | null;
  valid_until?: string | null;
}

interface ApiInquiry {
  id: string;
  user_id?: string;
  event_type: string | null;
  base: string | null;
  filling: string | null;
  coating: string | null;
  decorations?: string[] | null;
  dietary?: string[] | null;
  servings: number | null;
  city: string | null;
  delivery_date: string | null;
  delivery_type?: string | null;
  inscription?: string | null;
  comment: string | null;
  estimated_price: number | null;
  status: string;
  created_at?: string;
  submitted_at?: string;
  negotiations?: ApiNegotiation[];
}

export interface ApiConfectionerPublic {
  id: string;
  userId: string | null;
  businessName: string | null;
  avatar?: string | null;
}

export interface ApiRevision {
  id: string;
  negotiation_id: string;
  quoted_price?: number | null;
  quoted_delivery_cost?: number | null;
  quoted_prep_time?: string | null;
  discount_percent?: number | null;
  discount_comment?: string | null;
  changed_by: string;
  change_reason: string;
  created_at: string;
}

export interface ApiNegotiationDetail {
  id: string;
  inquiry_id: string;
  confectioner_id: string;
  status: string;
  quoted_price?: number | null;
  valid_until?: string | null;
  accepted_at?: string | null;
  revisions?: ApiRevision[];
}

// ===== Маппер (экспортирован для unit-тестов) =====

/**
 * Строка GET /api/inquiries + справочник имён кондитеров → UI-модель заявки
 * с массивом предложений.
 */
export function mapApiInquiryToBuyerInquiry(
  raw: ApiInquiry,
  confectionerNames: Map<string, { name: string; avatar: string | null }>,
  now: Date = new Date()
): BuyerInquiry {
  const offers: BuyerOffer[] = (raw.negotiations || []).map((n) => {
    const status: BuyerOfferStatus =
      n.status === "declined"
        ? "declined"
        : n.status === "accepted"
          ? "accepted"
          : n.status === "expired"
            ? "expired"
            : n.status === "counter_offered"
              ? "counter_offered"
              : n.status === "quoted"
                ? "quoted"
                : "pending";
    const info = confectionerNames.get(n.confectioner_id);
    return {
      negotiationId: n.id,
      inquiryId: raw.id,
      confectionerId: n.confectioner_id,
      confectionerName: info?.name || "Кондитер",
      confectionerAvatar: info?.avatar ?? null,
      quotedPriceKopecks: typeof n.quoted_price === "number" ? n.quoted_price : null,
      quotedDeliveryCostKopecks:
        typeof n.quoted_delivery_cost === "number" && n.quoted_delivery_cost > 0
          ? n.quoted_delivery_cost
          : null,
      quotedPrepTime: n.quoted_prep_time ?? null,
      rawStatus: n.status,
      status,
      quotedAt: n.quoted_at ?? null,
      acceptedAt: n.accepted_at ?? null,
      validUntil: n.valid_until ?? null,
      isExpired:
        n.status === "expired" ||
        (n.status === "quoted" &&
          !!n.valid_until &&
          new Date(n.valid_until).getTime() < now.getTime()),
    };
  });

  return {
    id: raw.id,
    eventType: raw.event_type,
    base: raw.base,
    filling: raw.filling,
    coating: raw.coating ?? null,
    decorations: raw.decorations || [],
    dietary: raw.dietary || [],
    servings: raw.servings ?? 8,
    city: raw.city,
    deliveryDate: raw.delivery_date,
    deliveryType: raw.delivery_type ?? null,
    inscription: raw.inscription ?? null,
    comment: raw.comment,
    estimatedPriceRub:
      typeof raw.estimated_price === "number"
        ? Math.round(raw.estimated_price) / 100
        : null,
    inquiryStatus: raw.status,
    createdAt: raw.created_at || raw.submitted_at || "",
    offers,
  };
}

// ===== Хуки =====

async function fetchBuyerInquiries(): Promise<ApiInquiry[]> {
  const headers = await getSessionAuthHeaders();
  const res = await fetch("/api/inquiries", { headers, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { inquiries?: ApiInquiry[] };
  return data.inquiries || [];
}

/** Публичный справочник кондитеров → Map<authUserId, {name, avatar}>. */
async function fetchConfectionerNames(): Promise<
  Map<string, { name: string; avatar: string | null }>
> {
  const res = await fetch("/api/confectioners?limit=100&verified_only=false", {
    credentials: "include",
  });
  if (!res.ok) return new Map(); // имена — best effort: без списка показываем «Кондитер»
  const data = (await res.json().catch(() => null)) as
    | { confectioners?: ApiConfectionerPublic[] }
    | null;
  const map = new Map<string, { name: string; avatar: string | null }>();
  for (const c of data?.confectioners || []) {
    if (c.userId) {
      map.set(c.userId, { name: c.businessName || "Кондитер", avatar: c.avatar ?? null });
    }
  }
  return map;
}

/** Реальные заявки покупателя с предложениями (GET /api/inquiries). */
export function useBuyerOffers() {
  const user = useAppStore((s) => s.user);

  return useQuery<BuyerInquiry[], Error>({
    queryKey: ["buyer-offers", user?.id ?? null],
    queryFn: async () => {
      const [inquiries, names] = await Promise.all([
        fetchBuyerInquiries(),
        fetchConfectionerNames(),
      ]);
      return inquiries.map((raw) => mapApiInquiryToBuyerInquiry(raw, names));
    },
    staleTime: 30_000,
    retry: 1,
    enabled: !!user,
  });
}

/** Детали переговоров + история revisions (GET /api/negotiations/[id]). */
export function useNegotiationDetail(negotiationId: string | null) {
  return useQuery<ApiNegotiationDetail, Error>({
    queryKey: ["negotiation-detail", negotiationId],
    queryFn: async () => {
      const headers = await getSessionAuthHeaders();
      const res = await fetch(`/api/negotiations/${negotiationId}`, {
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { negotiation?: ApiNegotiationDetail };
      return data.negotiation as ApiNegotiationDetail;
    },
    staleTime: 15_000,
    retry: 1,
    enabled: !!negotiationId,
  });
}

/** Код ошибки сервера (OFFER_EXPIRED / OFFER_NO_PRICE / …) внутри Error. */
export class NegotiationActionError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "NegotiationActionError";
    this.code = code;
  }
}

/** Принять предложение (PATCH /api/negotiations/[id] action:"accept"). */
export function useAcceptOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { negotiationId: string }): Promise<ApiNegotiationDetail> => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/negotiations/${input.negotiationId}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ action: "accept" }),
      });
      const body = (await res.json().catch(() => null)) as
        | { negotiation?: ApiNegotiationDetail; error?: string; message?: string }
        | null;
      if (!res.ok) {
        // 410 OFFER_EXPIRED / 409 OFFER_NO_PRICE — серверные коды, UI рисует
        // честное состояние по ним (см. BuyerOffersTab).
        throw new NegotiationActionError(
          body?.message || body?.error || `HTTP ${res.status}`,
          body?.error || null
        );
      }
      return body?.negotiation as ApiNegotiationDetail;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["buyer-offers"] });
      queryClient.invalidateQueries({ queryKey: ["negotiation-detail", variables.negotiationId] });
    },
  });
}

/**
 * Счётчик предложений, ждущих решения покупателя (badge «Согласование» в
 * сайдбаре кабинета). Делит кэш с useBuyerOffers (тот же queryKey) — лишнего
 * запроса не делает. Ошибка/нет пользователя → 0.
 */
export function useBuyerOffersPendingCount(): number {
  const { data, isError } = useBuyerOffers();
  return useMemo(() => {
    if (isError || !data) return 0;
    const now = Date.now();
    return data.reduce(
      (sum, inquiry) =>
        sum +
        inquiry.offers.filter(
          (o) =>
            o.status === "quoted" &&
            !o.isExpired &&
            (!o.validUntil || new Date(o.validUntil).getTime() > now)
        ).length,
      0
    );
  }, [data, isError]);
}
