/**
 * Operator canned responses — шаблоны быстрых ответов для операторов поддержки.
 *
 * Категории:
 *  - greeting — приветствие
 *  - apology — извинение за проблему
 *  - refund — возврат средств
 *  - discount — компенсация скидкой
 *  - escalation — перенос в другой отдел
 *  - closing — завершение диалога
 *  - faq — быстрые ответы на частые вопросы
 *
 * Каждый шаблон:
 *  - id, category, label (короткое название для кнопки)
 *  - text (текст ответа, может содержать плейсхолдеры {{userName}}, {{orderNumber}})
 *  - placeholders (список плейсхолдеров для подстановки)
 */

export interface CannedResponse {
  id: string;
  category: string;
  label: string;
  text: string;
  placeholders?: string[];
}

export const CANNED_RESPONSES: CannedResponse[] = [
  // === Приветствия ===
  {
    id: "greeting_standard",
    category: "greeting",
    label: "Приветствие",
    text: "Здравствуйте, {{userName}}! Меня зовут {{operatorName}}, я оператор поддержки «Уездного кондитера». Чем могу помочь?",
    placeholders: ["userName", "operatorName"],
  },
  {
    id: "greeting_callback",
    category: "greeting",
    label: "Перезвон",
    text: "Здравствуйте, {{userName}}! Видел ваше обращение по поводу заказа #{{orderNumber}}. Уточните, пожалуйста, детали проблемы.",
    placeholders: ["userName", "orderNumber"],
  },

  // === Извинения ===
  {
    id: "apology_quality",
    category: "apology",
    label: "Извинение за качество",
    text: "Приношу искренние извинения за то, что заказ не оправдал ваших ожиданий. Это не тот уровень сервиса, к которому мы стремимся. Давайте решим эту проблему — я готов предложить варианты компенсации.",
    placeholders: [],
  },
  {
    id: "apology_delay",
    category: "apology",
    label: "Извинение за задержку",
    text: "Извините за задержку с доставкой заказа #{{orderNumber}}. Я уже связался с кондитером и курьером — уточняю статус. Вернусь к вам с информацией в течение 10 минут.",
    placeholders: ["orderNumber"],
  },
  {
    id: "apology_wrong_item",
    category: "apology",
    label: "Не тот товар",
    text: "Понимаю, как обидно получить не тот заказ. Приношу извинения. Я оформлю возврат средств или переделаю заказ бесплатно — что вам удобнее?",
    placeholders: [],
  },

  // === Возврат средств ===
  {
    id: "refund_full",
    category: "refund",
    label: "Полный возврат",
    text: "Я оформил полный возврат средств за заказ #{{orderNumber}} в размере {{amount}}₽. Деньги вернутся на ту же карту в течение 3 рабочих дней. Бонусы уже возвращены на ваш счёт.",
    placeholders: ["orderNumber", "amount"],
  },
  {
    id: "refund_partial",
    category: "refund",
    label: "Частичный возврат",
    text: "Предлагаю частичный возврат {{percent}}% от стоимости заказа ({{amount}}₽) как компенсацию за обнаруженные недостатки. Согласны?",
    placeholders: ["percent", "amount"],
  },
  {
    id: "refund_explain",
    category: "refund",
    label: "Сроки возврата",
    text: "Возврат средств инициирован. Обычно деньги возвращаются на карту в течение 3 рабочих дней (зависит от банка). Бонусы возвращаются сразу. Если через 5 дней деньги не пришли — напишите, я подниму обращение в банк.",
    placeholders: [],
  },

  // === Скидки/компенсации ===
  {
    id: "discount_compensation",
    category: "discount",
    label: "Промокод 10%",
    text: "В качестве извинения дарю вам промокод SORRY10 на скидку 10% на следующий заказ. Промокод действует 30 дней.",
    placeholders: [],
  },
  {
    id: "discount_bonuses",
    category: "discount",
    label: "Бонусы 500₽",
    text: "Я начислил на ваш счёт 500 бонусов (эквивалент 500₽) как компенсацию за доставленные неудобства. Бонусы можно использовать при следующем заказе.",
    placeholders: [],
  },

  // === Эскалация ===
  {
    id: "escalation_finance",
    category: "escalation",
    label: "В финансовый отдел",
    text: "Ваш вопрос касается финансовой стороны (возврат более 10 000₽). Я передаю обращение в финансовый отдел — они свяжутся с вами в течение 24 часов по электронной почте.",
    placeholders: [],
  },
  {
    id: "escalation_legal",
    category: "escalation",
    label: "Юридический отдел",
    text: "Это юридический вопрос — передаю в юридический отдел. Специалист свяжется с вами в течение 1 рабочего дня. Все ваши обращения зафиксированы.",
    placeholders: [],
  },
  {
    id: "escalation_confectioner",
    category: "escalation",
    label: "Связь с кондитером",
    text: "Я передал ваш вопрос кондитеру «{{confectionerName}}». Он ответит вам в этом чате в течение 2 часов. Если не ответит — я напомню ему.",
    placeholders: ["confectionerName"],
  },

  // === Завершение ===
  {
    id: "closing_resolved",
    category: "closing",
    label: "Проблема решена",
    text: "Рад был помочь! Если возникнут ещё вопросы — пишите в этот чат, я на связи с 10:00 до 22:00 МСК. Хорошего дня! 🌸",
    placeholders: [],
  },
  {
    id: "closing_followup",
    category: "closing",
    label: "Фоллоу-ап",
    text: "Я закрываю это обращение. Если в течение 7 дней проблема повторится — просто напишите в чат «оператор», и я вернусь к вам. Спасибо за обращение!",
    placeholders: [],
  },
  {
    id: "closing_survey",
    category: "closing",
    label: "Опрос оценки",
    text: "Спасибо за обращение! Пожалуйста, оцените работу поддержки от 1 до 5 — это поможет нам стать лучше. Просто напишите цифру в чат.",
    placeholders: [],
  },

  // === FAQ быстрые ===
  {
    id: "faq_delivery_time",
    category: "faq",
    label: "Сроки доставки",
    text: "Доставка по Москве — день в день или на следующий день. По России — 2-7 дней через СДЭК/Boxberry. Точное время зависит от готовности торта.",
    placeholders: [],
  },
  {
    id: "faq_escrow",
    category: "faq",
    label: "Эскроу",
    text: "Эскроу — это промежуточный счёт, где ваши деньги находятся 24 часа после доставки. Если что-то не так — открываете спор, деньги остаются на эскроу. Если всё ок — через 24ч деньги уходят кондитеру.",
    placeholders: [],
  },
  {
    id: "faq_payment_methods",
    category: "faq",
    label: "Способы оплаты",
    text: "Принимаем: карта (Visa/MC/Мир), СБП, наличные при получении, рассрочка (Сплит/Тинькофф/Сбер), подарочные сертификаты. Все онлайн-платежи защищены 3-D Secure.",
    placeholders: [],
  },
];

/**
 * Получить шаблоны по категории.
 */
export function getCannedByCategory(category: string): CannedResponse[] {
  return CANNED_RESPONSES.filter((r) => r.category === category);
}

/**
 * Получить все категории.
 */
export function getCategories(): { id: string; label: string; count: number }[] {
  const labels: Record<string, string> = {
    greeting: "Приветствие",
    apology: "Извинения",
    refund: "Возврат",
    discount: "Компенсация",
    escalation: "Перенаправление",
    closing: "Завершение",
    faq: "FAQ",
  };
  const counts: Record<string, number> = {};
  for (const r of CANNED_RESPONSES) {
    counts[r.category] = (counts[r.category] || 0) + 1;
  }
  return Object.entries(counts).map(([id, count]) => ({
    id,
    label: labels[id] || id,
    count,
  }));
}

/**
 * Заполнить плейсхолдеры в шаблоне.
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}
