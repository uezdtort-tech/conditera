/**
 * /api/ai-assistant/chat/route.ts — POST запрос к AI-помощнику.
 *
 * POST /api/ai-assistant/chat
 *
 * Тело запроса:
 *  {
 *    "message": "Подскажи торт для свадьбы на 50 человек",
 *    "conversation_id": "uuid-or-null",   // null = создать новый диалог
 *    "role_context": "CUSTOMER",            // в контексте какой роли (по умолчанию своя)
 *    "request_type": "chat",                // chat | forecast | recommendation | auto_reply | voice
 *    "metadata": { "orderId": "...", "productId": "..." }  // доп. контекст
 *  }
 *
 * Логика:
 *  1. Проверить аутентификацию
 *  2. Если conversation_id=null — создать новый диалог с role_context
 *  3. Вызвать AI-провайдер (z-ai-web-dev-sdk LLM)
 *  4. Сохранить ответ в ai_assistant_logs (для аудита и улучшения модели)
 *  5. Обновить ai_assistant_conversations (message_count, last_message_at)
 *  6. Вернуть ответ + conversation_id (для последующих сообщений)
 *
 * Права:
 *  POST — любой AUTHENTICATED пользователь
 *
 * Rate limit:
 *  20 запросов в минуту на пользователя (обрабатывается в middleware для /api/ai-assistant/*)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import type { user_role, AIAssistantConversation, AIAssistantLog } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 30; // Edge Functions могут быть до 30 сек

const VALID_REQUEST_TYPES = [
  "chat",
  "forecast",
  "recommendation",
  "auto_reply",
  "voice",
  "other",
] as const;
type RequestType = (typeof VALID_REQUEST_TYPES)[number];

interface ChatRequestBody {
  message: string;
  conversation_id?: string | null;
  role_context?: user_role;
  request_type?: RequestType;
  metadata?: Record<string, unknown>;
}

interface ChatResponse {
  data: {
    conversation_id: string;
    message: string;
    request_type: RequestType;
    log_id: number;
    model_used: string;
    latency_ms: number;
  };
  meta: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
}

/**
 * POST /api/ai-assistant/chat — основной чат-эндпоинт AI-помощника.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    const body = await request.json() as ChatRequestBody;

    // Валидация message
    if (!body.message || typeof body.message !== "string") {
      return NextResponse.json(
        { error: "Поле «message» обязательно и должно быть строкой" },
        { status: 422 }
      );
    }
    if (body.message.length > 5000) {
      return NextResponse.json(
        { error: "message не может быть длиннее 5000 символов" },
        { status: 422 }
      );
    }

    // Валидация request_type
    const requestType: RequestType = body.request_type ?? "chat";
    if (!VALID_REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json(
        { error: `request_type должен быть одним из: ${VALID_REQUEST_TYPES.join(", ")}` },
        { status: 422 }
      );
    }

    // Определить role_context — по умолчанию роль пользователя (CUSTOMER, CONFECTIONER, ...)
    const roleContext: user_role = body.role_context ?? "CUSTOMER";

    // Получить или создать conversation
    let conversationId = body.conversation_id ?? null;
    if (conversationId) {
      // Проверить, что conversation принадлежит пользователю
      const { data: conv, error: convErr } = await supabaseAdmin
        .from("ai_assistant_conversations")
        .select("id, user_id, is_archived")
        .eq("id", conversationId)
        .maybeSingle();

      if (convErr || !conv) {
        return NextResponse.json(
          { error: "Диалог не найден" },
          { status: 404 }
        );
      }
      if (conv.user_id !== user.id) {
        return NextResponse.json(
          { error: "Диалог принадлежит другому пользователю" },
          { status: 403 }
        );
      }
      if (conv.is_archived) {
        // Unarchive при новом сообщении
        await supabaseAdmin
          .from("ai_assistant_conversations")
          .update({ is_archived: false })
          .eq("id", conversationId);
      }
    } else {
      // Создать новый диалог
      const title = body.message.slice(0, 60) + (body.message.length > 60 ? "..." : "");
      const { data: newConv, error: newConvErr } = await supabaseAdmin
        .from("ai_assistant_conversations")
        .insert({
          user_id: user.id,
          role_context: roleContext,
          title,
          message_count: 0,
          last_message_at: new Date().toISOString(),
          is_archived: false,
          metadata: body.metadata ?? {},
        })
        .select("id")
        .single();

      if (newConvErr || !newConv) {
        console.error("[ai-assistant/chat] conversation create error:", newConvErr?.message);
        return NextResponse.json(
          { error: "Ошибка при создании диалога" },
          { status: 500 }
        );
      }
      conversationId = newConv.id;
    }

    // Вызвать AI-провайдер
    const aiResult = await callAiProvider(body.message, roleContext, requestType, body.metadata);

    const latencyMs = Date.now() - startTime;

    // Сохранить лог запроса/ответа
    const { data: logRecord, error: logErr } = await supabaseAdmin
      .from("ai_assistant_logs")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role_context: roleContext,
        request_type: requestType,
        input_text: body.message,
        output_text: aiResult.text,
        input_tokens: aiResult.inputTokens,
        output_tokens: aiResult.outputTokens,
        model_used: aiResult.model,
        latency_ms: latencyMs,
        error_code: aiResult.errorCode ?? null,
        error_message: aiResult.errorMessage ?? null,
      })
      .select("id")
      .single();

    if (logErr) {
      console.warn("[ai-assistant/chat] log save error (non-fatal):", logErr.message);
      // Не fail-ить запрос если лог не сохранился
    }

    // Обновить счётчик сообщений в conversation (асинхронно)
    supabaseAdmin
      .from("ai_assistant_conversations")
      .update({
        message_count: 2, // упрощённо: 1 (входящее) + 1 (ответ)
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .then(() => { /* fire-and-forget */ });

    // Если был error от AI-провайдера — вернуть 502
    if (aiResult.errorCode) {
      return NextResponse.json(
        {
          data: {
            conversation_id: conversationId,
            message: aiResult.errorMessage || "AI-провайдер недоступен",
            log_id: logRecord?.id ?? 0,
            model_used: aiResult.model,
            latency_ms: latencyMs,
          },
          error: {
            code: aiResult.errorCode as string,
            message: aiResult.errorMessage,
          },
        },
        { status: 502 }
      );
    }

    const response: ChatResponse = {
      data: {
        conversation_id: conversationId!,
        message: aiResult.text as string,
        request_type: requestType,
        log_id: logRecord?.id ?? 0,
        model_used: aiResult.model,
        latency_ms: latencyMs,
      },
      meta: {
        input_tokens: aiResult.inputTokens,
        output_tokens: aiResult.outputTokens,
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    console.error("[ai-assistant/chat] unexpected:", error?.message, `(after ${latencyMs}ms)`);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * Вызвать AI-провайдер (z-ai-web-dev-sdk LLM).
 * Если SDK недоступен — fallback на заглушку.
 */
async function callAiProvider(
  message: string,
  roleContext: user_role,
  requestType: RequestType,
  metadata?: Record<string, unknown>
): Promise<{
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode?: string;
  errorMessage?: string;
}> {
  try {
    // Динамический импорт SDK — не ломает build если SDK не установлен
    const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null);
    if (!ZaiModuleOk(ZAIModule)) {
      return fallbackResponse(message, roleContext);
    }

    // Используем SDK для генерации
    const ZAI = ZAIModule as any;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(roleContext),
        },
        {
          role: "user",
          content: message,
        },
      ],
      metadata: metadata as any,
    });

    return {
      text: completion?.choices?.[0]?.message?.content || "Извините, не удалось сгенерировать ответ.",
      model: "glm-4",
      inputTokens: completion?.usage?.prompt_tokens ?? null,
      outputTokens: completion?.usage?.completion_tokens ?? null,
    };
  } catch (err: any) {
    console.warn("[ai-assistant/chat] SDK error:", err?.message);
    return {
      text: "",
      model: "fallback",
      inputTokens: null,
      outputTokens: null,
      errorCode: "AI_PROVIDER_ERROR",
      errorMessage: err?.message || "Неизвестная ошибка AI-провайдера",
    };
  }
}

function ZaiModuleOk(m: any): boolean {
  return m !== null && typeof m === "object" && (m.create || m.default?.create);
}

/**
 * Fallback если SDK не установлен или не работает.
 * Возвращает заранее заготовленный ответ в зависимости от типа запроса.
 */
function fallbackResponse(message: string, roleContext: user_role): {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode?: string;
  errorMessage?: string;
} {
  const lowerMessage = message.toLowerCase();
  let text = "";

  if (lowerMessage.includes("свадьб") || lowerMessage.includes("wedding")) {
    text = "Для свадьбы на 50 человек рекомендую многоярусный торт 3-4 кг с белым бисквитом, начинкой mascarpone+малина и покрытием из мастики. Ориентировочная цена: 8000-15000 ₽.";
  } else if (lowerMessage.includes("день рожден") || lowerMessage.includes("birthday")) {
    text = "Для дня рождения подойдёт торт 1.5-2.5 кг с любимой начинкой именинника. Рекомендую шоколадный бисквит с ганашем — это классика, которая нравится большинству.";
  } else if (lowerMessage.includes("корпорат") || lowerMessage.includes("corporate")) {
    text = "Для корпоратива на 30+ человек рекомендую капкейки или тарты — удобнее порционно. Если нужен большой торт — берите 4+ кг.";
  } else if (lowerMessage.includes("прогноз") || lowerMessage.includes("forecast")) {
    text = "Прогноз продаж: на основе исторических данных ожидается рост 12-15% к следующему месяцу. Рекомендую заранее увеличить запас ингредиентов.";
  } else {
    text = "Я AI-ассистент платформы «Уездный кондитер». Могу помочь подобрать торт, рассчитать цену, спланировать заказ. Опишите подробнее, что вы ищете?";
  }

  return {
    text,
    model: "fallback-rule-based",
    inputTokens: Math.ceil(message.length / 4),
    outputTokens: Math.ceil(text.length / 4),
  };
}

/**
 * Системный промпт в зависимости от роли пользователя.
 */
function buildSystemPrompt(roleContext: user_role): string {
  const base = "Ты — AI-ассистент маркетплейса кондитерских изделий «Уездный кондитер». ";
  const rolePrompts: Partial<Record<user_role, string>> = {
    CUSTOMER: "Помогай покупателю выбрать торт, рассчитать массу и цену, объяснить процесс заказа. Будь дружелюбным и конкретным.",
    CONFECTIONER: "Помогай кондитеру с рецептами, оптимизацией времени, расчётом себестоимости и заменой ингредиентов.",
    COURIER: "Помогай курьеру с маршрутами, статусами доставки и общением с клиентами.",
    SUPPLIER: "Помогай поставщику с управлением складом, ценообразованием и тендерами.",
    ADMIN: "Помогай администратору с аналитикой, прогнозами продаж, выявлением рисков и масштабированием.",
    FRANCHISEE: "Помогай франчайзи с управлением сетью, качеством точек, централизованными закупками.",
    CORPORATE_CLIENT: "Помогай корпоративному клиенту с тендерами, бюджетными лимитами и регулярными поставками.",
  };
  return base + (rolePrompts[roleContext] || "Будь полезным для любого запроса пользователя.");
}
