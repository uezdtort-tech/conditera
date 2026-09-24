/**
 * Content Moderation Engine — служба безопасности для проверки контента.
 *
 * Защита от:
 *  - Контента 18+ (порнография, насилие)
 *  - Призывов к экстремизму и противоправным действиям
 *  - Наркотиков, оружия, незаконных товаров
 *  - Спама, мошенничества, оскорблений
 *  - Разжигания ненависти
 *
 * Соответствие законодательству:
 *  - 152-ФЗ (защита детей от вредной информации)
 *  - ФЗ «О противодействии экстремизму»
 *  - Федеральный список экстремистских материалов
 *
 * Архитектура:
 *  1. Лексический анализ (стоп-слова, regex) — быстро, локально
 *  2. Внешний API (Yandex Safe Browsing, OpenAI moderation) — опционально
 *  3. ML-модель классификации — опционально (будущее)
 *  4. Ручная модерация — для спорных случаев
 *
 * Все проверки логируются в ModerationQueue для аудита.
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • При сбое загрузки кастомных правил — продолжаем с базовыми проверками.
 *   • При сбое insert в ModerationQueue — возвращаем status с synthetic queueId.
 */

import { supabaseAdmin } from "./supabase/admin";

// ===== Types =====

export type ContentType =
  | "product"
  | "product_review"
  | "confectioner_review"
  | "chat_message"
  | "broadcast"
  | "venue"
  | "service_product"
  | "event"
  | "user_profile"
  | "comment";

export interface ModerationInput {
  contentType: ContentType;
  contentId: string;
  authorId: string;
  authorName?: string;
  title?: string;
  content: string;          // текст для проверки
  images?: string[];        // URL изображений
}

export interface ModerationResult {
  status: "approved" | "flagged" | "rejected";
  score: number;            // 0-1, уровень риска
  violations: string[];    // категории найденных нарушений
  reasons: string[];        // подробные причины
  matchedRules: string[];  // ID сработавших правил
  queueId: string;          // ID записи в ModerationQueue
  requireManualReview: boolean;
}

// ===== Базовые списки стоп-слов =====
// ВАЖНО: Это минимальный набор. В production расширить через БД (ModerationRule).
// Списки намеренно неполные — для демонстрации архитектуры.

const STOP_WORDS_18PLUS: string[] = [
  // Порнография
  "порно", "порн", "xxx", "эротика", "секс", "интим", "проституция",
  "эскорт услуги", " individualki", "индивидуалки",
  // Насилие 18+
  "гуро", "снайфф", "расчленёнка",
];

const STOP_WORDS_EXTREMISM: string[] = [
  // Призывы к насилию
  "убить всех", "уничтожить", "сжечь заживо", "расстрелять",
  // Терроризм
  "бомба", "взрывчатка", "теракт", "шахид", "игил", "исламское государство",
  "аль-каида", "талибан", "боко харам",
  // Экстремизм
  "свастика", "нацизм", "фашизм", "расовая чистка", "геноцид",
  "разжигание ненависти", "национальная вражда",
  // Сепаратизм
  "отделение от рф", "государственный переворот",
];

const STOP_WORDS_DRUGS: string[] = [
  // Наркотики
  "наркотики", "наркота", "гашиш", "марихуана", "анаша", "план",
  "кокаин", "героин", "метамфетамин", "экстази", "лсд", "психоделики",
  "соль наркотик", "скорость наркотик", "спайс наркотик",
  "закладка наркотиков", "телеграм наркотики",
  // Реклама продажи
  "продам наркотики", "купить наркотики", "доставка наркотиков",
];

const STOP_WORDS_WEAPONS: string[] = [
  // Оружие (незаконное)
  "травмат без лицензии", "боевое оружие купить", "пистолет нелегально",
  "переделка оружия", "обрез", "автомат купить нелегально",
  // Взрывчатка
  "тнт купить", "аммоний селитра бомба", "самодельная бомба",
];

const STOP_WORDS_ILLEGAL: string[] = [
  // Подделка документов
  "купить паспорт", "фальшивый паспорт", "поддельные права",
  "купить диплом", "фальшивый диплом",
  // Незаконные услуги
  "убийца на заказ", "заказное убийство", "киллер",
  "взлом аккаунта", "взлом почты", "ddos заказ",
  // Финансовые преступления
  "обналичка", "отмывание денег", "кардинг", "скимминг",
  "продаю кредитки", "дампы карт",
];

const STOP_WORDS_SPAM: string[] = [
  // Спам-паттерны
  "заработок на дому 50000", "лёгкий заработок",
  "инвестиции 100% прибыль", "финансовая пирамида",
  "млм бизнес", "сетевой маркетинг заработок",
  // Контактные данные в описании (часто спам)
  // Проверяются отдельным правилом ниже
];

const STOP_WORDS_INSULT: string[] = [
  // Оскорбления (базовый набор)
  "идиот", "дурак", "придурок", "тупой", "дебил",
  "сволочь", "подонок", "мерзавец",
  // Нецензурная лексика (сокращённый список)
  "бля", "ху", "пизд", "еба", "срал", "ссан",
];

// ===== URL-паттерны (для блокировки внешних ссылок в описании) =====
const URL_REGEX = /https?:\/\/[^\s<]+/gi;
const PHONE_REGEX = /(\+?\d[\d\s\-()]{10,18})/g;
const EMAIL_REGEX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// ===== Категории нарушений =====
export const VIOLATION_CATEGORIES = {
  "18+": {
    label: "Контент 18+",
    description: "Порнография, насилие, материалы для взрослых",
    severity: "high",
    action: "reject",
  },
  "extremism": {
    label: "Экстремизм",
    description: "Призывы к насилию, терроризму, разжигание ненависти",
    severity: "critical",
    action: "reject",
  },
  "drugs": {
    label: "Наркотики",
    description: "Пропаганда и продажа наркотических веществ",
    severity: "critical",
    action: "reject",
  },
  "weapons": {
    label: "Оружие",
    description: "Незаконный оборот оружия и взрывчатых веществ",
    severity: "critical",
    action: "reject",
  },
  "illegal_goods": {
    label: "Незаконные товары/услуги",
    description: "Подделка документов, кардинг, заказные преступления",
    severity: "critical",
    action: "reject",
  },
  "spam": {
    label: "Спам",
    description: "Массовая рассылка, реклама финансовых пирамид",
    severity: "medium",
    action: "flag",
  },
  "insult": {
    label: "Оскорбления",
    description: "Нецензурная лексика, оскорбительные высказывания",
    severity: "medium",
    action: "flag",
  },
  "hate_speech": {
    label: "Разжигание ненависти",
    description: "Дискриминация по национальности, религии, полу",
    severity: "high",
    action: "reject",
  },
  "external_contacts": {
    label: "Внешние контакты",
    description: "Попытка увести клиента с платформы (телефон/email в описании)",
    severity: "low",
    action: "warn",
  },
} as const;

// ===== Core: moderate content =====

/**
 * Проверить контент на нарушения.
 * Создаёт запись в ModerationQueue и возвращает результат.
 *
 * @example
 *   const result = await moderateContent({
 *     contentType: "product",
 *     contentId: "p123",
 *     authorId: "u456",
 *     title: "Торт «Праздничный»",
 *     content: "Вкусный торт с кремом",
 *     images: ["https://..."],
 *   })
 *   if (result.status === "rejected") {
 *     return NextResponse.json({ error: "Контент отклонён модерацией" }, { status: 403 })
 *   }
 */
export async function moderateContent(
  input: ModerationInput
): Promise<ModerationResult> {
  const { contentType, contentId, authorId, title, content, images = [] } = input;

  // Нормализуем текст для проверки
  const textToCheck = `${title || ""} ${content}`.toLowerCase().trim();

  const violations: string[] = [];
  const reasons: string[] = [];
  const matchedRules: string[] = [];
  let maxScore = 0;

  // === 1. Проверка стоп-слов по категориям ===
  const checks = [
    { category: "18+", words: STOP_WORDS_18PLUS },
    { category: "extremism", words: STOP_WORDS_EXTREMISM },
    { category: "drugs", words: STOP_WORDS_DRUGS },
    { category: "weapons", words: STOP_WORDS_WEAPONS },
    { category: "illegal_goods", words: STOP_WORDS_ILLEGAL },
    { category: "spam", words: STOP_WORDS_SPAM },
    { category: "insult", words: STOP_WORDS_INSULT },
  ];

  for (const check of checks) {
    for (const word of check.words) {
      const pattern = checkWordToRegex(word);
      if (pattern.test(textToCheck)) {
        if (!violations.includes(check.category)) {
          violations.push(check.category);
        }
        reasons.push(`Найдено стоп-слово: "${word}" (категория: ${check.category})`);
        const severity = VIOLATION_CATEGORIES[check.category as keyof typeof VIOLATION_CATEGORIES]?.severity;
        const score = severity === "critical" ? 1.0 : severity === "high" ? 0.8 : 0.5;
        if (score > maxScore) maxScore = score;
      }
    }
  }

  // === 2. Проверка внешних контактов (попытка увести с платформы) ===
  // Разрешаем в user_profile, запрещаем в product/service_product
  if (contentType === "product" || contentType === "service_product" || contentType === "venue") {
    const phones = content.match(PHONE_REGEX);
    const emails = content.match(EMAIL_REGEX);
    const urls = content.match(URL_REGEX);

    // Разрешаем ссылки на соцсети (vk, instagram), но не телефоны/email
    const externalUrls = urls?.filter(
      (u) => !u.includes("conditera.ru") && !u.includes("vk.com") && !u.includes("instagram.com")
    );

    if (phones && phones.length > 0) {
      violations.push("external_contacts");
      reasons.push(`Найден телефон в описании: ${phones[0]}`);
      if (maxScore < 0.3) maxScore = 0.3;
    }
    if (emails && emails.length > 0) {
      violations.push("external_contacts");
      reasons.push(`Найден email в описании: ${emails[0]}`);
      if (maxScore < 0.3) maxScore = 0.3;
    }
    if (externalUrls && externalUrls.length > 0) {
      violations.push("external_contacts");
      reasons.push(`Внешняя ссылка: ${externalUrls[0]}`);
      if (maxScore < 0.2) maxScore = 0.2;
    }
  }

  // === 3. Загрузка кастомных правил из БД ===
  interface ModerationRuleRow {
    id: string;
    name: string;
    rule_type: string;
    pattern: string;
    case_sensitive: boolean | null;
    whole_word: boolean | null;
    violation: string;
    action: string;
    description: string | null;
    is_active: boolean | null;
  }
  interface SupabaseError { message: string; }

  try {
    const { data: customRules, error: rulesErr } = await supabaseAdmin
      .from("moderation_rules")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false }) as { data: ModerationRuleRow[] | null; error: SupabaseError | null };

    if (rulesErr) {
      console.warn("[moderation] Failed to load custom rules:", rulesErr.message);
    }

    for (const rule of customRules || []) {
      let isMatched = false;

      if (rule.rule_type === "regex") {
        try {
          const regex = new RegExp(rule.pattern, rule.case_sensitive ? "" : "i");
          if (regex.test(textToCheck)) isMatched = true;
        } catch {
          // Невалидный regex — пропускаем
        }
      } else if (rule.rule_type === "keywords") {
        const keywords = rule.pattern.split(",").map((k) => k.trim().toLowerCase());
        for (const keyword of keywords) {
          if (rule.whole_word) {
            const wordRegex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, rule.case_sensitive ? "" : "i");
            if (wordRegex.test(textToCheck)) {
              isMatched = true;
              break;
            }
          } else {
            if (textToCheck.includes(keyword)) {
              isMatched = true;
              break;
            }
          }
        }
      } else if (rule.rule_type === "url_pattern") {
        const urls = content.match(URL_REGEX) || [];
        for (const url of urls) {
          if (url.includes(rule.pattern.toLowerCase())) {
            isMatched = true;
            break;
          }
        }
      }

      if (isMatched) {
        violations.push(rule.violation);
        reasons.push(`Сработало правило "${rule.name}": ${rule.description || rule.pattern}`);
        matchedRules.push(rule.id);

        // Увеличиваем счётчик срабатываний (non-blocking, через RPC — atomic)
        supabaseAdmin
          .rpc("increment_moderation_rule_hits", { p_rule_id: rule.id })
          .then(({ error }: { error: SupabaseError | null }) => {
            if (error) {
              console.warn(`[moderation] hits increment failed for rule ${rule.id}:`, error.message);
            }
          })
          .then(undefined, (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[moderation] hits increment error for rule ${rule.id}:`, msg);
          });

        // Определяем score по action
        const score = rule.action === "reject" ? 1.0 : rule.action === "flag" ? 0.6 : 0.3;
        if (score > maxScore) maxScore = score;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[moderation] Failed to load custom rules:", msg);
  }

  // === 4. Определение статуса ===
  let status: ModerationResult["status"] = "approved";
  let requireManualReview = false;

  if (maxScore >= 1.0) {
    status = "rejected";
  } else if (maxScore >= 0.6) {
    status = "flagged";
    requireManualReview = true;
  } else if (maxScore >= 0.3) {
    status = "flagged";
    requireManualReview = false; // warn only
  }

  // === 5. Сохраняем в ModerationQueue ===
  const autoStatus =
    status === "approved" ? "approved" :
    status === "rejected" ? "rejected" :
    status === "flagged" && requireManualReview ? "flagged" :
    "flagged";

  const manualStatus =
    autoStatus === "approved" || (autoStatus === "flagged" && !requireManualReview)
      ? "not_required"
      : "pending";

  const { data: queueEntry, error: queueErr } = await supabaseAdmin
    .from("moderation_queue")
    .insert({
      content_type: contentType,
      content_id: contentId,
      author_id: authorId,
      author_name: input.authorName || null,
      title: title || null,
      content,
      images,
      auto_status: autoStatus,
      auto_reason: reasons.join("; ") || null,
      auto_score: maxScore,
      violations,
      manual_status: manualStatus,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single() as { data: { id: string } | null; error: SupabaseError | null };

  if (queueErr || !queueEntry) {
    console.error("[moderation] queue insert failed:", queueErr?.message);
    // Возвращаем synthetic queueId — модерация не должна блокироваться сбоем insert
    return {
      status,
      score: maxScore,
      violations,
      reasons,
      matchedRules,
      queueId: `synthetic-${Date.now()}`,
      requireManualReview,
    };
  }

  const queueId = queueEntry.id;

  // === 6. Уведомление модераторов при flag/reject ===
  if (status !== "approved") {
    try {
      const { sendToChannel } = await import("./telegram-bot");
      const violationLabels = violations
        .map((v) => VIOLATION_CATEGORIES[v as keyof typeof VIOLATION_CATEGORIES]?.label || v)
        .join(", ");
      await sendToChannel(
        `🚨 <b>Модерация контента</b>\n\n` +
        `<b>Тип:</b> ${contentType}\n` +
        `<b>Статус:</b> ${status.toUpperCase()}\n` +
        `<b>Нарушения:</b> ${violationLabels}\n` +
        `<b>Score:</b> ${maxScore.toFixed(2)}\n` +
        `<b>Автор:</b> ${input.authorName || authorId}\n\n` +
        `<pre>${content.slice(0, 500)}</pre>`
      );
    } catch {}
  }

  return {
    status,
    score: maxScore,
    violations,
    reasons,
    matchedRules,
    queueId,
    requireManualReview,
  };
}

// ===== Helper: convert word to regex =====

function checkWordToRegex(word: string): RegExp {
  // Экранируем спецсимволы
  const escaped = escapeRegex(word.toLowerCase());
  // Ищем как подстроку (word boundary может не работать с кириллицей)
  return new RegExp(escaped, "i");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ===== Helper: moderate image (stub for future AI integration) =====

/**
 * Проверка изображений на 18+ контент.
 * В будущем — интеграция с Yandex Vision API или OpenAI Vision.
 * Пока — заглушка (возвращает approved).
 */
export async function moderateImages(
  images: string[],
  contentType: ContentType
): Promise<{ approved: boolean; flagged: string[] }> {
  // TODO: Интеграция с Yandex Vision API
  // https://cloud.yandex.ru/docs/vision/quickstart
  // Метод detectModeration: adult, violence, racy
  // Пока возвращаем approved — все изображения проходят
  return { approved: true, flagged: [] };
}

// ===== Helper: bulk moderate =====

/**
 * Массовая модерация (для переиндексации существующего контента).
 * Использовать через /api/moderation/reindex (admin only).
 */
export async function moderateExistingContent(
  contentType: ContentType,
  batch = 100
): Promise<{ processed: number; flagged: number; rejected: number }> {
  let processed = 0;
  let flagged = 0;
  let rejected = 0;

  // Здесь должна быть логика загрузки существующих записей
  // и их проверки. Для каждого типа контента — отдельный запрос.
  // Заглушка — возвращаем 0.
  console.info(`[moderation] Bulk reindex for ${contentType}: ${processed} processed`);

  return { processed, flagged, rejected };
}

// ===== Helper: get queue stats =====

export async function getModerationStats(): Promise<{
  pending: number;
  flagged: number;
  approved: number;
  rejected: number;
  totalToday: number;
  reportsOpen: number;
}> {
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Параллельные count-запросы
  const [pendingQ, flaggedQ, approvedQ, rejectedQ, totalTodayQ, reportsOpenQ] = await Promise.all([
    supabaseAdmin.from("moderation_queue").select("*", { count: "exact", head: true }).eq("manual_status", "pending"),
    supabaseAdmin.from("moderation_queue").select("*", { count: "exact", head: true }).eq("auto_status", "flagged").eq("manual_status", "pending"),
    supabaseAdmin.from("moderation_queue").select("*", { count: "exact", head: true }).eq("auto_status", "approved"),
    supabaseAdmin.from("moderation_queue").select("*", { count: "exact", head: true }).eq("auto_status", "rejected"),
    supabaseAdmin.from("moderation_queue").select("*", { count: "exact", head: true }).gte("created_at", dayAgoIso),
    supabaseAdmin.from("content_reports").select("*", { count: "exact", head: true }).eq("status", "new"),
  ]);

  return {
    pending: pendingQ.count || 0,
    flagged: flaggedQ.count || 0,
    approved: approvedQ.count || 0,
    rejected: rejectedQ.count || 0,
    totalToday: totalTodayQ.count || 0,
    reportsOpen: reportsOpenQ.count || 0,
  };
}
