/**
 * AI-диалоговый движок с самообучением.
 *
 * Архитектура:
 *   1. Контекст отношений (RelationshipContext) — new/repeat/regular/vip
 *   2. Память диалогов (ConversationMemory) — извлечённые факты
 *   3. Профиль обучения (AILearningProfile) — агрегированные паттерны
 *
 * Поведение по типу отношений:
 *   new     — формальный, задаёт уточняющие вопросы, предлагает популярное
 *   repeat  — дружелюбный, помнит предпочтения, предлагает похожее
 *   regular — неформальный, проактивные предложения, персональные скидки
 *   vip     — персональный менеджер, приоритет, эксклюзивные предложения
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • При сбое БД — возвращаем null/пустые массивы (не блокируем caller).
 *   • Type-safe interfaces для всех функций.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

interface SupabaseError {
  message: string;
}

interface RelationshipContextRow {
  id: string;
  customer_id: string;
  confectioner_id: string;
  orders_count: number;
  chats_count: number;
  relationship_type: string;
  preferences: unknown;
  communication_style: unknown;
  key_facts: unknown;
  trust_score: number;
  avg_rating: number;
  last_order_id: string | null;
  last_order_date: string | null;
}

interface ConversationMemoryRow {
  id: string;
  customer_id: string;
  confectioner_id: string;
  memory_type: string;
  content: string;
  confidence: number;
  source_message_id: string | null;
  source_text: string | null;
  order_id: string | null;
  is_global: boolean | null;
  created_at: string;
}

export interface ExtractedFact {
  type: string;
  content: string;
  confidence: number;
}

export interface RelationshipContext {
  customerId: string;
  confectionerId: string;
  ordersCount: number;
  chatsCount: number;
  relationshipType: string;
  preferences: Record<string, unknown>;
  communicationStyle: Record<string, unknown>;
  keyFacts: unknown[];
  trustScore: number;
  avgRating: number;
  id?: string;
  lastOrderId?: string | null;
  lastOrderDate?: string | null;
}

export interface ConversationMemory {
  id: string;
  memoryType: string;
  content: string;
  confidence: number;
}

// === Определение типа отношений ===
export function classifyRelationship(ordersCount: number, chatsCount: number, trustScore: number): string {
  if (ordersCount >= 10 || trustScore >= 80) return "vip";
  if (ordersCount >= 5 || trustScore >= 50) return "regular";
  if (ordersCount >= 1 || chatsCount >= 2) return "repeat";
  return "new";
}

// === Получить контекст отношений ===
export async function getRelationshipContext(
  customerId: string,
  confectionerId: string
): Promise<RelationshipContext | null> {
  let ctx: RelationshipContext | null = null;

  try {
    const { data, error } = await supabaseAdmin
      .from("relationship_contexts")
      .select("*")
      .eq("customer_id", customerId)
      .eq("confectioner_id", confectionerId)
      .maybeSingle() as { data: RelationshipContextRow | null; error: SupabaseError | null };

    if (error) throw error;

    if (data) {
      ctx = {
        id: data.id,
        customerId: data.customer_id,
        confectionerId: data.confectioner_id,
        ordersCount: data.orders_count,
        chatsCount: data.chats_count,
        relationshipType: data.relationship_type,
        preferences: (data.preferences as Record<string, unknown>) || {},
        communicationStyle: (data.communication_style as Record<string, unknown>) || {},
        keyFacts: Array.isArray(data.key_facts) ? data.key_facts : [],
        trustScore: data.trust_score,
        avgRating: data.avg_rating,
        lastOrderId: data.last_order_id,
        lastOrderDate: data.last_order_date,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ai-dialogue] getRelationshipContext failed:", msg);
  }

  if (!ctx) {
    // Создаём новый контекст
    ctx = {
      customerId,
      confectionerId,
      ordersCount: 0,
      chatsCount: 0,
      relationshipType: "new",
      preferences: {},
      communicationStyle: {},
      keyFacts: [],
      trustScore: 0,
      avgRating: 0,
    };
    try {
      const { data: created, error: createErr } = await supabaseAdmin
        .from("relationship_contexts")
        .insert({
          customer_id: customerId,
          confectioner_id: confectionerId,
          orders_count: 0,
          chats_count: 0,
          relationship_type: "new",
          preferences: {},
          communication_style: {},
          key_facts: [],
          trust_score: 0,
          avg_rating: 0,
          created_at: new Date().toISOString(),
        })
        .select("*")
        .single() as { data: RelationshipContextRow | null; error: SupabaseError | null };

      if (createErr) throw createErr;
      if (created) {
        ctx.id = created.id;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue] relationship_context create failed:", msg);
    }
  }

  if (!ctx) return null;

  // Пересчитываем тип отношений
  const calculatedType = classifyRelationship(ctx.ordersCount, ctx.chatsCount, ctx.trustScore);
  if (calculatedType !== ctx.relationshipType && ctx.id) {
    try {
      await supabaseAdmin
        .from("relationship_contexts")
        .update({ relationship_type: calculatedType, updated_at: new Date().toISOString() })
        .eq("id", ctx.id);
      ctx.relationshipType = calculatedType;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue] relationship_type update failed:", msg);
    }
  }

  return ctx;
}

// === Получить память диалогов ===
export async function getConversationMemories(
  customerId: string,
  confectionerId?: string
): Promise<ConversationMemory[]> {
  try {
    // Supabase не поддерживает OR в одной цепочке — делаем 2 запроса и объединяем
    const queries = [
      supabaseAdmin
        .from("conversation_memories")
        .select("*")
        .eq("customer_id", customerId)
        .eq("is_global", true),
    ];

    if (confectionerId) {
      queries.push(
        supabaseAdmin
          .from("conversation_memories")
          .select("*")
          .eq("customer_id", customerId)
          .eq("confectioner_id", confectionerId)
      );
    }

    const results = await Promise.all(queries);
    const allMemories: ConversationMemoryRow[] = [];

    for (const result of results) {
      const { data, error } = result as { data: ConversationMemoryRow[] | null; error: SupabaseError | null };
      if (error) continue;
      if (data) allMemories.push(...data);
    }

    // Дедупликация по id (если один и тот же факт есть в обоих запросах)
    const seen = new Set<string>();
    const unique = allMemories.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    // Сортировка по confidence (desc), затем по created_at (desc)
    unique.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return unique.slice(0, 50).map((m) => ({
      id: m.id,
      memoryType: m.memory_type,
      content: m.content,
      confidence: m.confidence,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ai-dialogue] getConversationMemories failed:", msg);
    return [];
  }
}

// === Извлечение фактов из сообщения через LLM ===
export async function extractFactsFromMessage(
  message: string,
  senderRole: "customer" | "confectioner",
  context: { relationshipType: string; previousMessages: string[] }
): Promise<ExtractedFact[]> {
  const facts: ExtractedFact[] = [];

  // === Локальное извлечение (без LLM — быстрые паттерны) ===
  const lower = message.toLowerCase();

  // Аллергии
  const allergyPattern = /аллерг|не ем|не переношу|без глютен|без молок|без лактоз|без орех|без яиц|целиаки/i;
  if (allergyPattern.test(lower)) {
    const match = message.match(/(?:аллерг|не ем|не переношу|без)\s+([а-яё\s,]{3,40})/i);
    if (match) {
      facts.push({ type: "allergy", content: `Аллергия/ограничение: ${match[1].trim()}`, confidence: 0.85 });
    }
  }

  // Предпочтения вкусов
  const tastePatterns = [
    { regex: /люблю\s+([а-яё\s]{3,30})/i, type: "preference" },
    { regex: /обожаю\s+([а-яё\s]{3,30})/i, type: "preference" },
    { regex: /предпочитаю\s+([а-яё\s]{3,30})/i, type: "preference" },
    { regex: /хочу\s+([а-яё\s]{3,30})/i, type: "preference" },
  ];
  for (const { regex, type } of tastePatterns) {
    const match = message.match(regex);
    if (match) {
      facts.push({ type, content: `Предпочтение: ${match[1].trim()}`, confidence: 0.7 });
    }
  }

  // Бюджет
  const budgetMatch = message.match(/(\d+)\s*(тыс|тысяч|р|руб|₽)/i);
  if (budgetMatch) {
    const amount = parseInt(budgetMatch[1]) * (budgetMatch[2].match(/тыс|тысяч/i) ? 1000 : 1);
    facts.push({ type: "budget", content: `Бюджет: ${amount}₽`, confidence: 0.8 });
  }

  // Событие
  const eventPatterns = [
    { regex: /свадьб/i, content: "Свадьба" },
    { regex: /день рожд|др\s|день\s+рожд/i, content: "День рождения" },
    { regex: /корпоратив|офис/i, content: "Корпоратив" },
    { regex: /ребён|ребенок|детск|малыш/i, content: "Детский праздник" },
    { regex: /годовщин|аннивер/i, content: "Годовщина" },
  ];
  for (const { regex, content } of eventPatterns) {
    if (regex.test(lower)) {
      facts.push({ type: "event", content: `Событие: ${content}`, confidence: 0.75 });
    }
  }

  // === LLM извлечение (если есть сложный контекст) ===
  if (senderRole === "customer" && message.length > 50 && facts.length === 0) {
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const prompt = `Проанализируй сообщение покупателя кондитеру и извлеки ключевые факты.
Сообщение: "${message}"
Контекст: ${context.relationshipType} заказчик, предыдущие сообщения: ${context.previousMessages.slice(-3).join(" | ") || "нет"}

Верни JSON массив фактов: [{"type": "preference|allergy|budget|design|event|personal", "content": "краткое описание", "confidence": 0.0-1.0}]
Только JSON, без пояснений.`;

      const response = await zai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        stream: false,
        thinking: { type: "disabled" },
      });

      const reply = (response.choices?.[0]?.message?.content as string) || "";
      const jsonMatch = reply.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ExtractedFact[];
        if (Array.isArray(parsed)) {
          facts.push(...parsed.filter((f) => f.type && f.content));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue] LLM extract failed:", msg);
    }
  }

  return facts;
}

// === Генерация AI-ответа с контекстом ===
export async function generateContextualResponse(
  incomingMessage: string,
  context: {
    relationshipType: string;
    memories: ConversationMemory[];
    preferences: Record<string, unknown>;
    communicationStyle: Record<string, unknown>;
    ordersCount: number;
    customerName?: string;
    confectionerName?: string;
  }
): Promise<{ suggestion: string; reasoning: string; confidence: number }> {
  const { relationshipType, memories, preferences, ordersCount } = context;

  // === Локальная генерация (быстрая, без LLM) ===
  const lower = incomingMessage.toLowerCase();
  let localSuggestion = "";
  let reasoning = "";

  const favoriteFilling = (preferences?.favoriteFilling as string) || "шоколад";

  const patterns: Record<string, {
    greeting: string;
    budget: string;
    design: string;
    filling: string;
    default: string;
  }> = {
    new: {
      greeting: "Здравствуйте! Спасибо за обращение. ",
      budget: "Подскажите, какой у вас бюджет на торт? Я подберу оптимальный вариант.",
      design: "Какой дизайн вы хотели бы? У меня есть примеры в портфолио.",
      filling: "Какие начинки вы предпочитаете? У меня есть шоколадные, ягодные, кремовые варианты.",
      default: "Спасибо за сообщение! Уточните, пожалуйста, детали — я подберу для вас лучший вариант.",
    },
    repeat: {
      greeting: "Рад вас снова видеть! ",
      budget: "Как и в прошлый раз — подберём в вашем бюджете. Какой диапазон?",
      design: "Хотите что-то похожее на прошлый заказ или новый дизайн?",
      filling: `Помню, вы любите ${favoriteFilling}. Оставляем или попробуем новое?`,
      default: "Конечно! Я помню ваши предпочтения. Что бы вы хотели в этот раз?",
    },
    regular: {
      greeting: "Приветствую! Рад вас снова! ",
      budget: "Ваш обычный бюджет подойдёт? Или сегодня особый случай?",
      design: "Можем повторить прошлый дизайн с изменениями или придумать новый.",
      filling: `Как обычно — ${favoriteFilling}? Или экспериментируем?`,
      default: "Сделаем! Какие пожелания на этот раз?",
    },
    vip: {
      greeting: "Добрый день! Уже готовлю для вас. ",
      budget: "Бюджет не вопрос — сделаем премиально. Какие особые пожелания?",
      design: "Могу предложить эксклюзивный дизайн, которого ещё не было.",
      filling: `Ваш любимый ${favoriteFilling} или попробуете новинку?`,
      default: "Всё сделаю в лучшем виде! Какие детали обсудим?",
    },
  };

  const style = patterns[relationshipType] || patterns.new;

  // Определяем тип вопроса
  if (/привет|здравствуй|добр/.test(lower)) {
    localSuggestion = style.greeting.trim();
    reasoning = `Приветствие для ${relationshipType}-клиента`;
  } else if (/цена|стоим|сколько|бюджет|денег/.test(lower)) {
    localSuggestion = style.budget;
    reasoning = "Вопрос о цене — предлагаем обсудить бюджет";
  } else if (/дизайн|внешн|вид|украш|оформл/.test(lower)) {
    localSuggestion = style.design;
    reasoning = "Вопрос о дизайне — предлагаем варианты";
  } else if (/начинк|вкус|бисквит|крем|ягод|шоколад/.test(lower)) {
    localSuggestion = style.filling;
    reasoning = "Вопрос о начинках — учитываем предпочтения из памяти";
  } else if (/аллерг|не ем|без глютен|без молок/.test(lower)) {
    localSuggestion = "Поняла! Учту это ограничение. Предложу варианты без этого ингредиента.";
    reasoning = "Аллергия — критично, запоминаем";
  } else if (/свадьб|др|день рожд|корпоратив|праздник/.test(lower)) {
    localSuggestion = `Отличное событие! Какая дата и сколько гостей? Подберём идеальный торт.`;
    reasoning = "Событие — собираем ключевую информацию";
  } else {
    localSuggestion = style.default;
    reasoning = `Стандартный ответ для ${relationshipType}-клиента`;
  }

  // Добавляем персонализацию из памяти
  if (memories.length > 0 && relationshipType !== "new") {
    const topMemory = memories[0];
    if (topMemory.memoryType === "preference" && topMemory.confidence > 0.6) {
      localSuggestion += ` (Помню: ${topMemory.content})`;
    }
  }

  // === LLM генерация (если сообщение сложное) ===
  if (incomingMessage.length > 100) {
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const memoriesStr = memories.slice(0, 5).map((m) => `- ${m.content}`).join("\n");
      const systemPrompt = `Ты — AI-ассистент кондитера на маркетплейсе «Уездный кондитер».
Помоги кондитеру ответить покупателю.

Контекст отношений:
- Тип: ${relationshipType} (${ordersCount} заказов)
- Память о покупателе: ${memoriesStr || "нет данных"}
- Стиль общения: ${context.communicationStyle?.tone || "дружелюбный"}

Правила:
- ${relationshipType === "new" ? "Формальный, вежливый" : ""}
- ${relationshipType === "repeat" ? "Дружелюбный, помни прошлые заказы" : ""}
- ${relationshipType === "regular" ? "Неформальный, как старый знакомый" : ""}
- ${relationshipType === "vip" ? "Персональный, премиальный сервис" : ""}
- Кратко (1-3 предложения)
- По делу, без воды
- Учитывай предпочтения из памяти

Ответь ТОЛЬКО текстом ответа, без пояснений.`;

      const response = await zai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Сообщение покупателя: "${incomingMessage}"` },
        ],
        stream: false,
        thinking: { type: "disabled" },
      });

      const aiReply = response.choices?.[0]?.message?.content as string;
      if (aiReply && aiReply.trim().length > 10) {
        return { suggestion: aiReply.trim(), reasoning: "Сгенерировано через LLM с контекстом", confidence: 0.8 };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue] LLM generate failed:", msg);
    }
  }

  return { suggestion: localSuggestion, reasoning, confidence: 0.7 };
}

// === Сохранение извлечённых фактов в память ===
export async function saveMemories(
  customerId: string,
  confectionerId: string,
  facts: ExtractedFact[],
  sourceMessageId?: string,
  sourceText?: string,
  orderId?: string
): Promise<number> {
  let created = 0;
  for (const fact of facts) {
    try {
      // Проверяем — нет ли уже такой памяти
      const { data: existing } = await supabaseAdmin
        .from("conversation_memories")
        .select("id, confidence")
        .eq("customer_id", customerId)
        .eq("confectioner_id", confectionerId)
        .eq("memory_type", fact.type)
        .eq("content", fact.content)
        .maybeSingle() as { data: { id: string; confidence: number } | null; error: SupabaseError | null };

      if (existing) {
        // Обновляем confidence (берём максимум)
        if (fact.confidence > existing.confidence) {
          await supabaseAdmin
            .from("conversation_memories")
            .update({
              confidence: fact.confidence,
              source_message_id: sourceMessageId || null,
              source_text: sourceText || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        }
        continue;
      }

      await supabaseAdmin
        .from("conversation_memories")
        .insert({
          customer_id: customerId,
          confectioner_id: confectionerId,
          memory_type: fact.type,
          content: fact.content,
          confidence: fact.confidence,
          source_message_id: sourceMessageId || null,
          source_text: sourceText || null,
          order_id: orderId || null,
          is_global: fact.type === "allergy", // аллергии — глобальные
          created_at: new Date().toISOString(),
        });
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue] saveMemories failed:", msg);
    }
  }
  return created;
}

// === Обновление контекста после заказа ===
export async function updateRelationshipAfterOrder(
  customerId: string,
  confectionerId: string,
  orderId: string,
  orderTotal: number,
  rating?: number
): Promise<void> {
  try {
    const ctx = await getRelationshipContext(customerId, confectionerId);
    if (!ctx || !ctx.id) return;

    const newOrdersCount = ctx.ordersCount + 1;
    const newTrustScore = Math.min(100, ctx.trustScore + (rating ? rating * 10 : 5));
    const newAvgRating = rating
      ? (ctx.avgRating * ctx.ordersCount + rating) / newOrdersCount
      : ctx.avgRating;

    // Обновляем предпочтения
    const prefs = (ctx.preferences as Record<string, unknown>) || {};
    if (orderTotal > 0) {
      const budgetRange = (prefs.budgetRange as { min: number; max: number }) || { min: orderTotal, max: orderTotal };
      if (!prefs.budgetRange) {
        prefs.budgetRange = { min: orderTotal, max: orderTotal };
      } else {
        budgetRange.min = Math.min(budgetRange.min, orderTotal);
        budgetRange.max = Math.max(budgetRange.max, orderTotal);
        prefs.budgetRange = budgetRange;
      }
    }

    await supabaseAdmin
      .from("relationship_contexts")
      .update({
        orders_count: newOrdersCount,
        trust_score: newTrustScore,
        avg_rating: newAvgRating,
        last_order_id: orderId,
        last_order_date: new Date().toISOString(),
        preferences: prefs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ai-dialogue] updateRelationshipAfterOrder failed:", msg);
  }
}
