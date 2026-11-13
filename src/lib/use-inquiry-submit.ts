/**
 * use-inquiry-submit.ts — ZV33-4 §B12: минимальная проводка «отправить
 * кондитерам» из конструктора на РЕАЛЬНЫЙ поток inquiries/negotiations.
 *
 * До этой правки конструктор POST-ил только /api/quotes (таблица
 * quote_requests) — параллельный legacy-контур; GET /api/inquiries?filter=available
 * (вкладка «Заявки из конструктора») оставался пустым.
 *
 * Flow (минимальный, без изменения бэкенда):
 *   1. Черновик: POST /api/inquiries требует draftId из cake_builder_drafts —
 *      REST-эндпоинта для черновиков нет, поэтому создаём запись через
 *      supabaseBrowser (тот же механизм, что у легаси-хука useSaveDraft).
 *      Если запись не удалась (нет Supabase-сессии в песочнице) — мутация
 *      падает, вызывающий код откатывается на legacy /api/quotes.
 *   2. confectionerIds: negotiations.confectioner_id — это auth users UUID,
 *      а конструктор выбирает confectioners.id → резолвим через публичный
 *      GET /api/confectioners (id → userId). Без резолва переговоры никогда
 *      не сматчатся с userId кондитера.
 *   3. POST /api/inquiries { draftId, confectionerIds, estimatedPrice }
 *      с CSRF-заголовками (getSessionAuthHeaders). estimatedPrice — КОПЕЙКИ.
 *   4. Успех → тост + подсказка перейти во вкладку «Предложения кондитеров».
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";

/** Снимок проекта торта для черновика (поля миграции 0004 cake_builder_drafts). */
export interface InquiryDraftSnapshot {
  event_type: string | null;
  base: string | null;
  filling: string | null;
  coating: string | null;
  decorations: string[];
  dietary: string[];
  servings: number;
  city: string;
  delivery_date: string | null;
  delivery_type: string;
  inscription: string | null;
  comment: string | null;
}

export interface SubmitInquiryInput {
  snapshot: InquiryDraftSnapshot;
  /** confectioners.id из шага 8 конструктора — резолвим в auth users UUID */
  confectionerIds: string[];
  /** Оценка в КОПЕЙКАХ (inquiries.estimated_price) */
  estimatedPriceKopecks: number;
}

interface ConfectionerPublicRow {
  id: string;
  userId: string | null;
}

/** Резолв confectioners.id → auth users UUID (публичный GET /api/confectioners). */
async function resolveConfectionerUserIds(
  ids: string[]
): Promise<string[]> {
  const unique = [...new Set(ids)];
  const res = await fetch("/api/confectioners?limit=100&verified_only=false", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Справочник кондитеров недоступен (HTTP ${res.status})`);
  const data = (await res.json().catch(() => null)) as
    | { confectioners?: ConfectionerPublicRow[] }
    | null;
  const byId = new Map<string, string>();
  for (const c of data?.confectioners || []) {
    if (c.userId) byId.set(c.id, c.userId);
  }
  return unique
    .map((id) => byId.get(id))
    .filter((v): v is string => !!v);
}

export function useSubmitInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitInquiryInput): Promise<{ inquiryId: string }> => {
      // 1. Черновик (supabaseBrowser — REST-эндпоинта для drafts нет; падаем
      //    наружу, если Supabase-сессии нет, чтобы вызывающий ушёл в fallback).
      const { data: draft, error: draftError } = await supabaseBrowser
        .from("cake_builder_drafts")
        .insert({ ...input.snapshot, step: 8, is_submitted: false })
        .select()
        .single();
      if (draftError || !draft) {
        throw new Error(draftError?.message || "Черновик не сохранён");
      }

      // 2. confectioners.id → auth users UUID (иначе переговоры «повиснут в воздухе»)
      const confectionerUserIds = await resolveConfectionerUserIds(input.confectionerIds);
      if (confectionerUserIds.length === 0) {
        throw new Error("Не удалось сопоставить выбранных кондитеров");
      }

      // 3. Создание inquiry + negotiations (CSRF + Bearer — единый auth-контракт)
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          draftId: draft.id,
          confectionerIds: confectionerUserIds,
          estimatedPrice: Math.round(input.estimatedPriceKopecks),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { inquiryId?: string; error?: string; detail?: string }
        | null;
      if (!res.ok || !body?.inquiryId) {
        throw new Error(body?.error || body?.detail || `HTTP ${res.status}`);
      }
      return { inquiryId: body.inquiryId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-offers"] });
    },
  });
}
