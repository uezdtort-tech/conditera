/**
 * Финансовый аудит проекта «Уездный кондитер»
 * 
 * Анализ соответствия финансовой модели и ролей.
 * Дата: 2026-07-16
 */

// ===== 1. АУДИТ ФИНАНСОВОЙ МОДЕЛИ =====

export const FINANCE_AUDIT = {
  // ✅ РЕАЛИЗОВАНО:
  implemented: [
    "Тарифы кондитеров: START (15%), PROFI (10%), PREMIUM (5%)",
    "YooKassa комиссия: 2.5% (интегрирована, mock-режим)",
    "Эскроу: 24 часа холдирование",
    "Налоги: НПД (4-6%), УСН (6-15%), ОСНО (20% НДС), ПСН",
    "Лояльность: 4 уровня (Bronze→Platinum), кэшбек 0-10%",
    "Доставка: базовая 300₽, бесплатная от 3000₽, экспресс 600₽",
    "Рассрочка: Сплит, Тинькофф, Сбербанк",
    "Скидки: промокоды, акции, запрос скидки в конструкторе",
    "Выплаты кондитерам: с учётом комиссии + налог + YooKassa fee",
  ],

  // ❌ ОТСУТСТВУЕТ / ТРЕБУЕТ ДОРАБОТКИ:
  missing: [
    "Комиссия для FOOD_SERVICE (кафе/рестораны) — нет отдельного тарифа",
    "Комиссия для SUPPLIER (поставщики) — нет отдельного тарифа",
    "Комиссия для STUDIO (декор) — использует тариф кондитера, нужен свой",
    "B2B-эскроу для корпоративных заказов (от 50 000₽)",
    "Частичная оплата — нет функции расчёта остатка",
    "Выплаты поставщикам — нет функции calculateSupplierPayout()",
    "Выплаты кафе/ресторанам — нет функции calculateFoodServicePayout()",
    "Агентская комиссия для EVENT_ORGANIZER — нет",
    "Реферальная комиссия — нет функции расчёта",
    "Страховой депозит для премиум-заказов — нет",
  ],
};

// ===== 2. ТАРИФЫ ДЛЯ ВСЕХ РОЛЕЙ =====

export const ROLE_TARIFFS = {
  // Кондитеры
  CONFECTIONER: {
    START: { commission: 0.15, monthly: 0, label: "Старт" },
    PROFI: { commission: 0.10, monthly: 990, label: "Профи" },
    PREMIUM: { commission: 0.05, monthly: 2990, label: "Премиум" },
  },
  // Точки общепита (кафе/рестораны)
  FOOD_SERVICE: {
    CAFE: { commission: 0.12, monthly: 1490, label: "Кафе" },
    RESTAURANT: { commission: 0.08, monthly: 2990, label: "Ресторан" },
    CHAIN: { commission: 0.05, monthly: 9900, label: "Сеть" },
  },
  // Производители декора
  STUDIO: {
    HOBBY: { commission: 0.15, monthly: 0, label: "Начинающий" },
    PRO: { commission: 0.10, monthly: 1490, label: "Профи" },
    STUDIO_PRO: { commission: 0.07, monthly: 3490, label: "Студия" },
  },
  // Поставщики ингредиентов/оборудования
  SUPPLIER: {
    BASIC: { commission: 0.08, monthly: 0, label: "Базовый" },
    PRO: { commission: 0.05, monthly: 1990, label: "Профи" },
    ENTERPRISE: { commission: 0.03, monthly: 5990, label: "Корпоратив" },
  },
  // Организаторы мероприятий
  EVENT_ORGANIZER: {
    AGENT: { commission: 0.05, monthly: 0, label: "Агент" },
    AGENCY: { commission: 0.03, monthly: 4990, label: "Агентство" },
  },
  // Площадки (венчурные)
  VENUE_OWNER: {
    FREE: { commission: 0.00, monthly: 0, label: "Бесплатно" },
    PROMO: { commission: 0.00, monthly: 1990, label: "Продвижение" },
  },
  // ПВЗ
  PICKUP_POINT: {
    FREE: { commission: 0.00, monthly: 0, label: "Бесплатно" },
    PRO: { commission: 0.00, monthly: 490, label: "Про" },
  },
};

// ===== 3. ФИНАНСОВЫЕ ФУНКЦИИ ДЛЯ РОЛЕЙ =====

export interface PayoutResult {
  orderAmount: number;
  commission: number;
  yookassaFee: number;
  tax: number;
  netPayout: number;
  escrowHoldHours: number;
  details: string;
}

/**
 * Расчёт выплаты для любой роли.
 */
export function calculateRolePayout(
  orderAmount: number,
  role: string,
  tariffKey: string,
  legalInfo?: { status: string; ipUsnRate?: string },
  isLegalEntity?: boolean,
): PayoutResult {
  const roleTariffs = (ROLE_TARIFFS as Record<string, Record<string, { commission: number; monthly: number; label: string }>>)[role];
  const tariff = roleTariffs?.[tariffKey] || { commission: 0.15, monthly: 0, label: "Старт" };

  const commission = Math.round(orderAmount * tariff.commission);
  const yookassaFee = Math.round(orderAmount * 0.025);
  const grossPayout = orderAmount - commission - yookassaFee;

  // Налог (если есть legalInfo)
  let tax = 0;
  let taxDetails = "Налог не рассчитан (физлицо)";
  if (legalInfo?.status === "NPD") {
    const rate = isLegalEntity ? 0.06 : 0.04;
    tax = Math.round(grossPayout * rate);
    taxDetails = `НПД ${rate * 100}%: ${tax}₽`;
  } else if (legalInfo?.status === "IP") {
    const rate = parseFloat((legalInfo.ipUsnRate || "6%").replace("%", "")) / 100;
    tax = Math.round(grossPayout * rate);
    taxDetails = `УСН ${legalInfo.ipUsnRate}: ${tax}₽`;
  } else if (legalInfo?.status === "OOO") {
    tax = Math.round(grossPayout * 0.20);
    taxDetails = `ОСНО 20%: ${tax}₽`;
  }

  return {
    orderAmount,
    commission,
    yookassaFee,
    tax,
    netPayout: grossPayout - tax,
    escrowHoldHours: 24,
    details: `${tariff.label}: комиссия ${tariff.commission * 100}% (${commission}₽) + YooKassa 2.5% (${yookassaFee}₽) + ${taxDetails}`,
  };
}

/**
 * Расчёт частичной оплаты.
 */
export function calculatePartialPayment(
  totalAmount: number,
  prepaidAmount: number,
): {
  prepaid: number;
  remaining: number;
  prepaidPercent: number;
  isFullyPaid: boolean;
} {
  const remaining = Math.max(0, totalAmount - prepaidAmount);
  const prepaidPercent = Math.round((prepaidAmount / totalAmount) * 100);
  return {
    prepaid: prepaidAmount,
    remaining,
    prepaidPercent,
    isFullyPaid: remaining === 0,
  };
}

/**
 * Агентская комиссия для организатора мероприятий.
 */
export function calculateAgentCommission(
  orderAmount: number,
  agentRate: number = 0.05,
): {
  agentFee: number;
  confectionerPayout: number;
} {
  const agentFee = Math.round(orderAmount * agentRate);
  return {
    agentFee,
    confectionerPayout: orderAmount - agentFee,
  };
}

// ===== 4. ФУНКЦИОНАЛ РОЛЕЙ =====

export const ROLE_FUNCTIONALITY = {
  FOOD_SERVICE: {
    label: "Точки общепита (кафе/рестораны)",
    features: [
      "Каталог десертов (свои + от кондитеров на реализации)",
      "Приём заказов на банкеты/фуршеты",
      "Дегустации для клиентов (бронирование столов)",
      "Продажа кондитерских изделий на реализацию (консигнация)",
      "B2B-заказы от корпоративных клиентов",
      "Финансы: комиссия 5-12% (зависит от тарифа), выплата раз в неделю",
      "Интеграция с iiko/r_keeper (future)",
    ],
    financeModel: "Комиссия с продаж + абонентская плата. Консигнация: 70/30 (кафе/кондитер).",
    dashboard: "B2B-кабинет: заказы, каталог, дегустации, финансы, аналитика",
  },
  STUDIO: {
    label: "Производители декора",
    features: [
      "Каталог декор-изделий (фигурки, цветы, топперы, упаковка)",
      "Заказы на индивидуальный декор",
      "Оптовые поставки кондитерам",
      "Печать на сахарной бумаге/пряниках",
      "Финансы: комиссия 7-15%, выплата раз в неделю",
      "Шаблоны декора (повторяющиеся изделия)",
    ],
    financeModel: "Комиссия с продаж + абонентская плата. Опт: скидка 20-40% от розницы.",
    dashboard: "Студия декора: каталог, заказы, оптовые прайсы, печать, финансы",
  },
  SUPPLIER: {
    label: "Поставщики ингредиентов/оборудования",
    features: [
      "Каталог ингредиентов (мука, сахар, масло, ягоды, шоколад)",
      "Каталог оборудования (печи, миксеры, формы)",
      "Оптовые и розничные цены",
      "Доставка по регионам",
      "B2B-договоры с кондитерами (регулярные поставки)",
      "Финансы: комиссия 3-8%, выплата раз в неделю",
      "Складской учёт (остатки, сроки годности)",
    ],
    financeModel: "Комиссия с продаж + абонентская плата. B2B-контракты: индивидуальные условия.",
    dashboard: "Поставщик: каталог, опт, склад, B2B-контракты, доставка, финансы",
  },
  EVENT_ORGANIZER: {
    label: "Организаторы мероприятий",
    features: [
      "Приём заявок на мероприятия (свадьбы, корпоративы)",
      "Подбор кондитеров под бюджет клиента",
      "Агентская комиссия с заказа (3-5%)",
      "Координация нескольких кондитеров на одном мероприятии",
      "Финансы: агентская комиссия, выплата после завершения мероприятия",
      "Портфолио проведённых мероприятий",
    ],
    financeModel: "Агентская комиссия 3-5% от суммы заказа. Без абонентской платы.",
    dashboard: "Организатор: заявки, подбор кондитеров, мероприятия, агентские",
  },
  VENUE_OWNER: {
    label: "Владельцы площадок",
    features: [
      "Каталог площадок (залы, лофты, веранды)",
      "Бронирование дат для мероприятий",
      "Прайс-листы (арда, кейтеринг, техника)",
      "Партнёрство с кондитерами (размещение дегустаций)",
      "Финансы: бесплатное размещение, платное продвижение",
    ],
    financeModel: "Бесплатное размещение. Продвижение: 1990₽/мес. Комиссия 0%.",
    dashboard: "Площадка: бронирование, прайсы, партнёры, аналитика",
  },
  PICKUP_POINT: {
    label: "Пункты выдачи заказов (ПВЗ)",
    features: [
      "Приём заказов от кондитеров для выдачи клиентам",
      "Хранение (с холодильником или без)",
      "Уведомления клиентам о готовности заказа",
      "Подтверждение получения заказа",
      "Финансы: комиссия за хранение/выдачу (10-50₽/заказ)",
    ],
    financeModel: "Бесплатно. Про: 490₽/мес за расширенные функции. Комиссия за выдачу.",
    dashboard: "ПВЗ: заказы к выдаче, хранение, клиенты, уведомления",
  },
  BLOGGER: {
    label: "Блогеры/инфлюенсеры",
    features: [
      "Каталог обзоров кондитерских изделий",
      "Реферальные ссылки (промокоды)",
      "Заработок: % с заказов по реферальной ссылке",
      "Запросы на обзоры от кондитеров",
      "Финансы: 5-10% с первого заказа по рефералке",
    ],
    financeModel: "Реферальная комиссия 5-10% с первого заказа. Без абонентской платы.",
    dashboard: "Блогер: обзоры, рефералки, заработок, запросы",
  },
  TASTER: {
    label: "Дегустаторы",
    features: [
      "Запись на дегустации в точках общепита",
      "Отзывы с оценкой (вкус, текстура, подача)",
      "Сертификаты дегустатора (уровни: новичок→эксперт)",
      "Финансы: бесплатно для дегустатора, платит кондитер/кафе",
    ],
    financeModel: "Дегустатор: бесплатно. Кондитер/кафе: 100-500₽ за дегустацию.",
    dashboard: "Дегустатор: записи, отзывы, сертификаты, рейтинг",
  },
  CORPORATE_CLIENT: {
    label: "Корпоративные клиенты (B2B)",
    features: [
      "B2B-заказы (объёмные, регулярные)",
      "Безналичная оплата (счёт, акт, договор)",
      "Согласование с несколькими кондитерами",
      "Бюджеты и отчётность",
      "Финансы: скидка 5-15% от объёма, без комиссии",
    ],
    financeModel: "Скидка 5-15% от объёма. Без комиссии. Оплата по счёту с НДС/без.",
    dashboard: "Корпоративный клиент: заказы, бюджеты, отчёты, договоры",
  },
  NUTRITIONIST: {
    label: "Нутрициологи",
    features: [
      "Каталог ПП-десертов (с КБЖУ)",
      "Рекомендации клиентам по выбору десертов",
      "Сертификация ПП-изделий",
      "Финансы: абонентская плата 990₽/мес",
    ],
    financeModel: "Абонентская плата 990₽/мес. Комиссия 0%.",
    dashboard: "Нутрициолог: ПП-каталог, клиенты, сертификация",
  },
  FRANCHISEE: {
    label: "Франчайзи",
    features: [
      "Региональное представительство",
      "Управление кондитерами в регионе",
      "Роялти: 2-5% от оборота региона",
      "Финансы: паушальный взнос + роялти",
    ],
    financeModel: "Паушальный взнос 100 000₽. Роялти 2-5% от оборота.",
    dashboard: "Франчайзи: регион, кондитеры, оборот, роялти",
  },
  QUALITY_INSPECTOR: {
    label: "Инспекторы качества",
    features: [
      "Проверка кондитеров (санитарные нормы, сертификаты)",
      "Проверка продукции (соответствие фото, вес, состав)",
      "Жалобы и санкции",
      "Финансы: зарплата от платформы",
    ],
    financeModel: "Фиксированная зарплата от платформы.",
    dashboard: "Инспектор: проверки, жалобы, санкции, сертификаты",
  },
  CERTIFICATION_AGENT: {
    label: "Сертифицирующие агенты",
    features: [
      "Сертификация кондитеров (HACCP, декларация соответствия)",
      "Проверка документов (СГР, декларации)",
      "Финансы: комиссия за сертификацию (5000-50000₽)",
    ],
    financeModel: "Комиссия за сертификацию 5000-50000₽ за услугу.",
    dashboard: "Сертификатор: заявки, документы, сертификаты",
  },
  COPYWRITER: {
    label: "Копирайтеры/контент-менеджеры",
    features: [
      "Создание описаний для товаров",
      "Создание рецептов и статей для блога",
      "Модерация отзывов",
      "Финансы: оплата за единицу контента",
    ],
    financeModel: "Оплата за единицу: 50-500₽ за описание/статью.",
    dashboard: "Копирайтер: задачи, статьи, описания, отзывы",
  },
};
