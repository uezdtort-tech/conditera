/**
 * Контур эскалаций поддержки — единый источник записи в `chat_escalations`
 * (миграция 0019_missing_runtime_tables.sql).
 *
 * Первопричина (Z-v16 инвентаризация, пробел SUPPORT-1):
 *   /api/chat/auto-reply вставлял эскалации в `operator_escalations` (0010),
 *   где ticket_id/operator_id NOT NULL — каждый insert падал 23502 и тихо
 *   глотался (catch → console.warn). Операторский дашборд при этом читает
 *   `chat_escalations` (operator/escalations|assign|resolve) — очередь
 *   всегда была пуста, а бот сообщал «передал оператору».
 *
 * Этот модуль — единственная точка создания эскалаций чата:
 *   • колонки строго по 0019: chat_room_id, user_id, reason, priority
 *     (low|normal|high|urgent), status (pending|assigned|resolved|closed|
 *     cancelled), metadata jsonb;
 *   • дедуп на уровне приложения: пока у комнаты открыта эскалация
 *     (pending ИЛИ assigned), повторные запросы НЕ создают дубль
 *     (UNIQUE-констрейнта в 0019 нет); новая запись — только после
 *     resolved/closed/cancelled;
 *   • fail-safe: ошибки возвращаются в результате, не бросаются — эскалация
 *     не должна ломать отправку сообщения.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Стемы запроса оператора. Русские стемы морфологически усечены
 * («поддержк» покрывает поддержка/поддержку/поддержки), латинские — полные.
 * Сопоставление по началу сообщения (как в легаси auto-reply), но без `\b`:
 * JS-`\b` ASCII-only и на кириллице не срабатывает — легаси-паттерн
 * /^(оператор|...)\b/i не соответствовал ни одному русскому сообщению.
 */
const OPERATOR_REQUEST_STEMS = [
  "оператор",
  "поддержк",
  "человек",
  "operator",
  "support",
  "human",
  "agent",
  "help",
] as const;

/** Ведущая пунктуация/кавычки — «- оператор» и «"Помогите!"» тоже запрос. */
const LEADING_NOISE = /^[\s!.,;:?!«»"'`~(\[\-—*#]+/;

/**
 * Явный ли это запрос живого оператора. True только когда стем стоит
 * в начале текста (после снятия ведущего шума) — семантика легаси-regex
 * `^(оператор|...)`, но работающая на кириллице. Хвост буквы допускаем
 * намеренно: усечённые стемы морфологии («поддержка» → «поддержк» + 'а').
 */
export function looksLikeOperatorRequest(text: string): boolean {
  if (typeof text !== "string") return false;
  const normalized = text.trim().toLowerCase().replace(LEADING_NOISE, "");
  if (normalized.length === 0) return false;
  return OPERATOR_REQUEST_STEMS.some((stem) => normalized.startsWith(stem));
}

export interface ChatEscalationInput {
  /** UUID канала chat_channels (canonical). Не UUID легаси chat_rooms. */
  chatRoomId: string;
  /** ID автора запроса (пользователь, попросивший оператора). */
  userId: string;
  /** Отображаемое имя автора (снимок в metadata). */
  userName?: string | null;
  /** Причина: 'manual_request' | 'complaint' | 'bot_unknown' | ... */
  reason: string;
  /** Приоритет по CHECK 0019; по умолчанию high для явного запроса. */
  priority?: "low" | "normal" | "high" | "urgent";
  /** Превью сообщения пользователя (снимок контекста для оператора). */
  messagePreview?: string | null;
  /** Источник триггера для диагностики. */
  source?: string;
}

export interface ChatEscalationResult {
  escalationId: string | null;
  /** true — создана новая запись; false — уже была pending либо ошибка. */
  created: boolean;
  error?: string;
}

/**
 * Создать (или переиспользовать) pending-эскалацию комнаты.
 * Не бросает исключений — результат описывает исход.
 */
export async function createChatEscalation(
  input: ChatEscalationInput
): Promise<ChatEscalationResult> {
  try {
    if (!input.chatRoomId || !input.userId) {
      return { escalationId: null, created: false, error: "chatRoomId и userId обязательны" };
    }

    // Дедуп: у комнаты уже есть ОТКРЫТАЯ (pending или assigned) эскалация?
    // Пока оператор не завершил (resolved/closed/cancelled), повторные
    // запросы не плодят записи в очереди — новое сообщение пользователя
    // оператор видит в том же треде.
    const { data: existing, error: selectErr } = await supabaseAdmin
      .from("chat_escalations")
      .select("id")
      .eq("chat_room_id", input.chatRoomId)
      .in("status", ["pending", "assigned"])
      .limit(1);

    if (selectErr) {
      // Отсутствие таблицы/доступа — честная ошибка, не создаём дубль вслепую
      return { escalationId: null, created: false, error: selectErr.message };
    }
    if (existing && existing.length > 0) {
      return { escalationId: existing[0].id, created: false };
    }

    const { data, error } = await supabaseAdmin
      .from("chat_escalations")
      .insert({
        chat_room_id: input.chatRoomId,
        user_id: input.userId,
        reason: input.reason,
        priority: input.priority ?? "high",
        status: "pending",
        metadata: {
          source: input.source ?? "chat_operator_request",
          user_name: input.userName ?? null,
          message_preview: input.messagePreview ? input.messagePreview.slice(0, 500) : null,
        },
      })
      .select("id")
      .single();

    if (error) {
      return { escalationId: null, created: false, error: error.message };
    }
    return { escalationId: data?.id ?? null, created: true };
  } catch (e) {
    return {
      escalationId: null,
      created: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
