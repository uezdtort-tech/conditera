/**
 * use-real-inquiries.ts — реальные заявки из конструктора для кондитера
 * (Этап 10 §D1: раньше вкладка «Заявки» читала zustand-мок MOCK_CONSTRUCTOR_INQUIRIES,
 * хотя GET /api/inquiries?filter=available и PATCH /api/negotiations/[id] работали).
 *
 * Поток: покупатель отправляет заявку из конструктора → inquiry (статус open)
 * + negotiations на выбранных кондитеров (pending_confectioner). Кондитер:
 *   • quote   — PATCH /api/negotiations/[id] { action:"quote", quotedPrice,
 *               comment?, validDays? } (ZV33-4: срок действия + комментарий);
 *   • decline — PATCH /api/negotiations/[id] { action:"decline" }
 *
 * Единицы: inquiries.estimated_price и negotiations.quoted_price — КОПЕЙКИ
 * (миграция 0004/0005); UI оперирует рублями — конвертация здесь.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

export type ConfectionerInquiryStatus =
  | "new"
  | "quoted"
  | "accepted"
  | "expired"
  | "declined"
  | "counter_offered";

export interface ConfectionerInquiry {
  id: string;
  customerName: string;
  eventType: string | null;
  base: string | null;
  filling: string | null;
  servings: number;
  city: string | null;
  /** рубли (estimated_price из БД — копейки) */
  budget: number;
  deliveryDate: string | null;
  createdAt: string;
  /**
   * Агрегированный статус для бейджей (ZV33-4):
   *   new — ждёт отклика кондитера; quoted — предложение отправлено;
   *   accepted — принято покупателем; expired — срок действия истёк
   *   (серверный статус или valid_until в прошлом — UI сравнивает сам);
   *   counter_offered — покупатель запросил изменение; declined — отклонена.
   */
  status: ConfectionerInquiryStatus;
  /** Сырой статус переговоров из API (pending_confectioner/quoted/…) */
  rawStatus: string;
  /** Последняя предложенная цена — КОПЕЙКИ (null — предложения ещё нет) */
  quotedPriceKopecks: number | null;
  /** Последняя предложенная цена — рубли (удобство для prefill формы) */
  quotedPriceRub: number | null;
  /** Срок действия предложения (valid_until, ISO) — null до первого quote */
  validUntil: string | null;
  /** Момент принятия покупателем (accepted_at, ISO) */
  acceptedAt: string | null;
  /** Срок изготовления из последнего предложения */
  quotedPrepTime: string | null;
  comment: string | null;
  /** переговоры этого кондитера по заявке (для quote/decline) */
  negotiationId: string | null;
}

interface ApiNegotiation {
  id: string;
  confectioner_id: string;
  status: string;
  // ZV33-4: поля индивидуального предложения (0004/0085) — КОПЕЙКИ
  quoted_price?: number | null;
  quoted_delivery_cost?: number | null;
  quoted_prep_time?: string | null;
  valid_until?: string | null;
  accepted_at?: string | null;
  quoted_at?: string | null;
}

interface ApiInquiry {
  id: string;
  user_id: string;
  event_type: string | null;
  base: string | null;
  filling: string | null;
  servings: number | null;
  city: string | null;
  estimated_price: number | null;
  delivery_date: string | null;
  comment: string | null;
  status: string;
  created_at?: string;
  submitted_at?: string;
  customer_name?: string | null;
  negotiations?: ApiNegotiation[];
}

/** Чистый маппер строки API → UI-модель (экспортирован для unit-тестов) */
export function mapApiInquiryToInquiry(raw: ApiInquiry, userId: string): ConfectionerInquiry {
  const own = (raw.negotiations || []).find((n) => n.confectioner_id === userId);
  // ZV33-4: surfaced raw status — accepted/expired/counter_offered больше не
  // сваливаются в "quoted" (раньше accepted был неотличим от предложения).
  const rawStatus = own?.status || "pending_confectioner";
  const status: ConfectionerInquiryStatus =
    rawStatus === "declined"
      ? "declined"
      : rawStatus === "accepted"
        ? "accepted"
        : rawStatus === "expired"
          ? "expired"
          : rawStatus === "counter_offered"
            ? "counter_offered"
            : rawStatus === "quoted"
              ? "quoted"
              : "new";
  const quotedPriceKopecks =
    typeof own?.quoted_price === "number" ? own.quoted_price : null;
  return {
    id: raw.id,
    customerName: raw.customer_name || "",
    eventType: raw.event_type,
    base: raw.base,
    filling: raw.filling,
    servings: raw.servings ?? 8,
    city: raw.city,
    budget: Math.round((raw.estimated_price || 0) / 100),
    deliveryDate: raw.delivery_date,
    createdAt: raw.created_at || raw.submitted_at || "",
    status,
    rawStatus,
    quotedPriceKopecks,
    quotedPriceRub: quotedPriceKopecks === null ? null : quotedPriceKopecks / 100,
    validUntil: own?.valid_until ?? null,
    acceptedAt: own?.accepted_at ?? null,
    quotedPrepTime: own?.quoted_prep_time ?? null,
    comment: raw.comment,
    negotiationId: own?.id ?? null,
  };
}

async function fetchAvailableInquiries(userId: string): Promise<ConfectionerInquiry[]> {
  const headers = await getSessionAuthHeaders();
  const res = await fetch("/api/inquiries?filter=available", { headers, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { inquiries?: ApiInquiry[] };
  return (data.inquiries || []).map((raw) => mapApiInquiryToInquiry(raw, userId));
}

/** Реальные открытые заявки с фолбэком на store-мок при ошибке API */
export function useRealInquiries() {
  const user = useAppStore((s) => s.user);
  const fallbackRaw = useAppStore((s) => s.inquiries);

  const query = useQuery<ConfectionerInquiry[], Error>({
    queryKey: ["inquiries-real", user?.id ?? null],
    queryFn: () => fetchAvailableInquiries(user!.id),
    staleTime: 30_000,
    retry: 1,
    enabled: !!user,
  });

  const failed = !!query.error;

  // Фолбэк (мок) приводим к единой форме: negotiationId нет → действия
  // quote/decline честно заблокированы (демо-данные нельзя «откликнуть»).
  const fallbackInquiries: ConfectionerInquiry[] = (fallbackRaw as Array<Record<string, unknown>>).map(
    (m) => ({
      id: String(m.id),
      customerName: (m.customerName as string) || "",
      eventType: (m.eventType as string) || null,
      base: (m.base as string) || null,
      filling: (m.filling as string) || null,
      servings: (m.servings as number) ?? 8,
      city: (m.city as string) || null,
      budget: (m.budget as number) ?? 0,
      deliveryDate: (m.deliveryDate as string) || null,
      createdAt: (m.createdAt as string) || "",
      status: ((m.status as string) === "quoted" ? "quoted" : "new") as ConfectionerInquiry["status"],
      rawStatus: (m.status as string) === "quoted" ? "quoted" : "pending_confectioner",
      quotedPriceKopecks: null,
      quotedPriceRub: null,
      validUntil: null,
      acceptedAt: null,
      quotedPrepTime: null,
      comment: (m.comment as string) || null,
      negotiationId: null,
    })
  );

  return {
    realInquiries: query.data ?? null,
    fallbackInquiries,
    inquiries: query.data ?? fallbackInquiries,
    isStale: failed,
    isLoading: query.isLoading,
    refetch: () => void query.refetch(),
  };
}

/**
 * Кондитер предлагает цену (quotedPrice уходит в КОПЕЙКАХ).
 * ZV33-4: validDays — срок действия предложения (клампится сервером 1..60,
 * дефолт 14; клиент клампит тем же clampOfferValidityDays для превью) и
 * comment — необязательный комментарий к предложению.
 */
export interface QuoteNegotiationResult {
  negotiation?: {
    id?: string;
    status?: string;
    quoted_price?: number | null;
    valid_until?: string | null;
  };
}

export function useQuoteNegotiation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      negotiationId: string;
      priceRub: number;
      comment?: string;
      validDays?: number;
    }): Promise<QuoteNegotiationResult> => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/negotiations/${input.negotiationId}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "quote",
          quotedPrice: Math.round(input.priceRub * 100),
          comment: input.comment,
          ...(input.validDays !== undefined ? { validDays: input.validDays } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as QuoteNegotiationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inquiries-real"] });
    },
  });
}

/** Кондитер отклоняет заявку (переговоры → declined) */
export function useDeclineNegotiation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { negotiationId: string }) => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch(`/api/negotiations/${input.negotiationId}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ action: "decline" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inquiries-real"] });
    },
  });
}
