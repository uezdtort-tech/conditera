// Финансовый модуль платформы "Кондитера"
// Реализует расчёт комиссий, НПД (самозанятость), эскроу и выплат

import type { Confectioner, LegalInfo, LegalStatus } from "./types";

// Тарифные планы — комиссия платформы
export const TARIFFS = {
  START: {
    name: "Старт",
    commission: 0.15, // 15%
    yookassa: 0.025, // 2.5%
    total: 0.175,
    monthly: 0,
    benefits: ["Базовая витрина", "Стандартная аналитика", "Поддержка в чате"],
  },
  PROFI: {
    name: "Профи",
    commission: 0.10, // 10%
    yookassa: 0.025,
    total: 0.125,
    monthly: 990,
    benefits: ["Расширенная витрина", "Конструктор тортов", "Приоритет в поиске", "Финансовая аналитика", "CRM"],
  },
  PREMIUM: {
    name: "Премиум",
    commission: 0.05, // 5%
    yookassa: 0.025,
    total: 0.075,
    monthly: 2990,
    benefits: [
      "Максимальная витрина",
      "Социальный канал",
      "Командная работа",
      "Расширенная аналитика",
      "Менеджер аккаунта",
      "Эксклюзивные заказы",
    ],
  },
  // Schema 0017 (Tariff enum): BASIC + BUSINESS — добавлены для совместимости с БД.
  // Алиасы на существующие тарифы, чтобы не дублировать UI.
  BASIC: {
    name: "Базовый",
    commission: 0.12, // 12%
    yookassa: 0.025,
    total: 0.145,
    monthly: 490,
    benefits: ["Расширенная витрина", "Конструктор тортов"],
  },
  BUSINESS: {
    name: "Бизнес",
    commission: 0.08, // 8%
    yookassa: 0.025,
    total: 0.105,
    monthly: 4990,
    benefits: [
      "Максимальная витрина",
      "Менеджер аккаунта",
      "API-доступ",
      "Премиум-поддержка 24/7",
    ],
  },
} as const;

// ===== ЮРИДИЧЕСКИЕ СТАТУСЫ =====
export const LEGAL_STATUS_INFO: Record<
  LegalStatus,
  {
    label: string;
    shortLabel: string;
    description: string;
    color: string;
    icon: string;
    // Обязательные требования
    requiresInn: boolean;
    requiresOgrn: boolean;
    requiresBankAccount: boolean;
    // Ограничения
    maxAnnualIncome: number | null;
    canWorkWithB2B: boolean;
    canIssueVatInvoice: boolean; // счёт-фактура с НДС
    // Налоговые ставки
    taxRateIndividual: number; // ставка при продаже физлицу
    taxRateLegal: number; // ставка при продаже юрлицу
  }
> = {
  NPD: {
    label: "Самозанятый (НПД)",
    shortLabel: "НПД",
    description: "Налог на профессиональный доход. Без сотрудников, лимит 2.4 млн ₽/год",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: "👤",
    requiresInn: true,
    requiresOgrn: false,
    requiresBankAccount: false,
    maxAnnualIncome: 2400000,
    canWorkWithB2B: true,
    canIssueVatInvoice: false,
    taxRateIndividual: 0.04, // 4% с физлиц
    taxRateLegal: 0.06, // 6% с юрлиц
  },
  IP: {
    label: "Индивидуальный предприниматель",
    shortLabel: "ИП",
    description: "Индивидуальный предприниматель. Можно нанимать сотрудников. УСН 6% или 15%",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    icon: "🏢",
    requiresInn: true,
    requiresOgrn: true, // ОГРНИП
    requiresBankAccount: true,
    maxAnnualIncome: null, // нет лимита
    canWorkWithB2B: true,
    canIssueVatInvoice: false, // при УСН — без НДС
    taxRateIndividual: 0.06, // УСН 6% (доходы)
    taxRateLegal: 0.06,
  },
  OOO: {
    label: "Общество с ограниченной ответственностью",
    shortLabel: "ООО",
    description: "Юридическое лицо. УСН 6%, УСН 15% или ОСНО с НДС. Полная бухгалтерия",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    icon: "🏛️",
    requiresInn: true,
    requiresOgrn: true, // ОГРН
    requiresBankAccount: true,
    maxAnnualIncome: null,
    canWorkWithB2B: true,
    canIssueVatInvoice: true, // при ОСНО
    taxRateIndividual: 0.06, // УСН 6% или 20% НДС + 20% налог на прибыль (ОСНО)
    taxRateLegal: 0.06,
  },
  PHYSICAL: {
    label: "Физическое лицо",
    shortLabel: "ФЛ",
    description: "Физлицо без регистрации. Только разовые продажи. Не подходит для бизнеса",
    color: "bg-slate-100 text-slate-800 border-slate-200",
    icon: "👤",
    requiresInn: false,
    requiresOgrn: false,
    requiresBankAccount: false,
    maxAnnualIncome: 600000, // до 600 тыс — можно без НПД
    canWorkWithB2B: false,
    canIssueVatInvoice: false,
    taxRateIndividual: 0.13, // НДФЛ 13%
    taxRateLegal: 0.13,
  },
};

// НПД — налог на профессиональный доход
export const NPD = {
  rateIndividual: 0.04, // 4% с физлиц
  rateLegal: 0.06, // 6% с юрлиц
  // Льготный вычет 10 000₽ при регистрации (снижает ставки до 3% и 4%)
  deduction: 10000,
  reducedRateIndividual: 0.03,
  reducedRateLegal: 0.04,
  maxAnnualIncome: 2400000, // лимит для самозанятых
};

// УСН — упрощённая система налогообложения (для ИП и ООО)
export const USN = {
  rateIncome: 0.06, // УСН «Доходы» — 6%
  rateIncomeExpenses: 0.15, // УСН «Доходы минус расходы» — 15%
  // Для ИП страховые взносы за себя (2026)
  ipFixedContributions: 53400, // фиксированные взносы ИП в год
  ipContributionRate: 1, // 1% с дохода свыше 300 000 ₽
  ipContributionThreshold: 300000,
};

// ОСНО — общая система (для ООО)
export const OSNO = {
  vatRate: 0.20, // НДС 20%
  profitTaxRate: 0.20, // налог на прибыль 20%
};

// Эскроу
export const ESCROW = {
  holdHours: 24, // 24 часа холдирование
  releaseAfter: 24 * 60 * 60 * 1000, // в мс
};

// Доставка
export const DELIVERY = {
  baseCost: 300,
  freeFrom: 3000,
  expressCost: 600,
  // Стоимость по расстоянию
  perKm: 15,
  // Платная зона (если дальше serviceRadiusKm)
  extendedPerKm: 25,
};

// Лояльность
export const LOYALTY = {
  BRONZE: { name: "Бронзовый", minSpent: 0, discount: 0, multiplier: 1 },
  SILVER: { name: "Серебряный", minSpent: 5000, discount: 0.03, multiplier: 1.2 },
  GOLD: { name: "Золотой", minSpent: 15000, discount: 0.05, multiplier: 1.5 },
  PLATINUM: { name: "Платиновый", minSpent: 50000, discount: 0.10, multiplier: 2 },
};

// ===== ФУНКЦИИ РАСЧЁТА =====

// Расчёт расстояния между двумя точками (формула Гаверсинуса)
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // радиус Земли в км
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// Проверка, обслуживает ли кондитер данный город
export function confectionerServesCity(
  confectioner: Pick<Confectioner, "location" | "city">,
  city: string
): boolean {
  if (confectioner.city.toLowerCase() === city.toLowerCase()) return true;
  return (confectioner.location.deliveryCities || [])
    .some((c) => c.toLowerCase() === city.toLowerCase());
}

// Проверка, доставляет ли кондитер по координатам
export function confectionerDeliversToCoords(
  confectioner: Pick<Confectioner, "location">,
  lat: number,
  lng: number
): { delivers: boolean; distance: number; inZone: boolean } {
  if (!confectioner.location.lat || !confectioner.location.lng) {
    return { delivers: false, distance: 0, inZone: false };
  }
  const distance = calculateDistance(
    confectioner.location.lat,
    confectioner.location.lng,
    lat,
    lng
  );
  const radius = confectioner.location.serviceRadiusKm || 0;
  return {
    delivers: distance <= radius,
    distance,
    inZone: distance <= radius,
  };
}

// Функция расчёта комиссии по тарифу
export function calculateCommission(
  amount: number,
  tariff: keyof typeof TARIFFS = "START"
): {
  platformFee: number;
  yookassaFee: number;
  totalFee: number;
  confectionerPayout: number;
} {
  const t = TARIFFS[tariff];
  const platformFee = Math.round(amount * t.commission);
  const yookassaFee = Math.round(amount * t.yookassa);
  const totalFee = platformFee + yookassaFee;
  const confectionerPayout = amount - totalFee;
  return { platformFee, yookassaFee, totalFee, confectionerPayout };
}

// Расчёт НПД
export function calculateNPD(
  amount: number,
  isLegalEntity: boolean = false,
  totalYearIncome: number = 0
): {
  tax: number;
  rate: number;
  remainingDeduction: number;
  isReducedRate: boolean;
} {
  const remainingDeduction = Math.max(0, NPD.deduction - totalYearIncome);
  const isReducedRate = remainingDeduction > 0;
  const rate = isLegalEntity
    ? isReducedRate
      ? NPD.reducedRateLegal
      : NPD.rateLegal
    : isReducedRate
    ? NPD.reducedRateIndividual
    : NPD.rateIndividual;
  const tax = Math.round(amount * rate);
  return { tax, rate, remainingDeduction, isReducedRate };
}

// Расчёт УСН для ИП
export function calculateIP(
  amount: number,
  usnRate: "6%" | "15%" = "6%",
  expenses: number = 0,
  yearIncome: number = 0
): {
  tax: number;
  rate: number;
  fixedContributions: number;
  contributionForIncome: number; // 1% с дохода свыше 300к
  totalTax: number;
} {
  const rate = usnRate === "6%" ? USN.rateIncome : USN.rateIncomeExpenses;
  const taxableBase = usnRate === "6%" ? amount : Math.max(0, amount - expenses);
  const tax = Math.round(taxableBase * rate);

  // Страховые взносы ИП за себя (распределяем на месяц)
  const fixedContributions = Math.round(USN.ipFixedContributions / 12);
  const contributionForIncome =
    yearIncome > USN.ipContributionThreshold
      ? Math.round(Math.max(0, amount - Math.max(0, USN.ipContributionThreshold - (yearIncome - amount))) * USN.ipContributionRate)
      : 0;

  return {
    tax,
    rate,
    fixedContributions,
    contributionForIncome,
    totalTax: tax, // взносы уменьшают налог, но для простоты показываем отдельно
  };
}

// Расчёт налога для ООО
export function calculateOOO(
  amount: number,
  taxSystem: "OSNO" | "USN_6" | "USN_15" | "VAT" = "USN_6",
  expenses: number = 0,
  hasVat: boolean = false
): {
  tax: number;
  vat: number;
  rate: number;
  totalTax: number;
} {
  let tax = 0;
  let vat = 0;
  let rate = 0;

  if (taxSystem === "USN_6") {
    rate = 0.06;
    tax = Math.round(amount * rate);
  } else if (taxSystem === "USN_15") {
    rate = 0.15;
    tax = Math.round(Math.max(0, amount - expenses) * rate);
  } else if (taxSystem === "OSNO" || taxSystem === "VAT") {
    // ОСНО: НДС 20% + налог на прибыль 20%
    if (hasVat) {
      vat = Math.round(amount * OSNO.vatRate);
    }
    rate = OSNO.profitTaxRate;
    tax = Math.round(Math.max(0, amount - expenses) * rate);
  }

  return { tax, vat, rate, totalTax: tax + vat };
}

// Универсальный расчёт налогов по юридическому статусу
export function calculateTaxByLegalStatus(
  amount: number,
  legalInfo: LegalInfo,
  isLegalEntity: boolean = false,
  yearIncome: number = 0,
  expenses: number = 0
): {
  status: LegalStatus;
  tax: number;
  rate: number;
  details: string;
  fixedContributions?: number;
} {
  switch (legalInfo.status) {
    case "NPD":
      const npd = calculateNPD(amount, isLegalEntity, yearIncome);
      return {
        status: "NPD",
        tax: npd.tax,
        rate: npd.rate,
        details: `НПД ${npd.isReducedRate ? "(льготная ставка, вычет " + formatCurrency(npd.remainingDeduction) + " ост.)" : ""}: ${Math.round(npd.rate * 100)}% ${isLegalEntity ? "с юрлица" : "с физлица"}`,
      };
    case "IP":
      const ip = calculateIP(amount, legalInfo.ipUsnRate || "6%", expenses, yearIncome);
      return {
        status: "IP",
        tax: ip.tax,
        rate: ip.rate,
        details: `УСН ${legalInfo.ipUsnRate || "6%"}: ${formatCurrency(ip.tax)} + взносы ${formatCurrency(ip.fixedContributions)}/мес`,
        fixedContributions: ip.fixedContributions,
      };
    case "OOO":
      const ooo = calculateOOO(amount, legalInfo.oooTaxSystem || "USN_6", expenses, legalInfo.oooTaxSystem === "VAT" || legalInfo.oooTaxSystem === "OSNO");
      return {
        status: "OOO",
        tax: ooo.totalTax,
        rate: ooo.rate,
        details: `${legalInfo.oooTaxSystem === "OSNO" || legalInfo.oooTaxSystem === "VAT" ? "ОСНО + НДС 20%" : legalInfo.oooTaxSystem === "USN_15" ? "УСН 15% (доходы − расходы)" : "УСН 6%"}: налог ${formatCurrency(ooo.tax)}${ooo.vat > 0 ? " + НДС " + formatCurrency(ooo.vat) : ""}`,
      };
    case "PHYSICAL":
    default:
      const ndfl = Math.round(amount * 0.13);
      return {
        status: "PHYSICAL",
        tax: ndfl,
        rate: 0.13,
        details: `НДФЛ 13% с физлица`,
      };
  }
}

// Расчёт финальной выплаты кондитеру (с учётом юридического статуса)
export function calculateConfectionerPayout(
  orderAmount: number,
  confectioner: Pick<Confectioner, "tariff" | "taxMode" | "legalInfo">,
  isLegalEntity: boolean = false,
  yearIncome: number = 0,
  expenses: number = 0
): {
  gross: number;
  platformCommission: number;
  yookassaFee: number;
  tax: number;
  taxDetails: string;
  netPayout: number;
  escrowHoldHours: number;
  legalStatus: LegalStatus;
} {
  const commission = calculateCommission(orderAmount, confectioner.tariff);
  const taxInfo = calculateTaxByLegalStatus(
    commission.confectionerPayout,
    confectioner.legalInfo,
    isLegalEntity,
    yearIncome,
    expenses
  );

  return {
    gross: orderAmount,
    platformCommission: commission.platformFee,
    yookassaFee: commission.yookassaFee,
    tax: taxInfo.tax,
    taxDetails: taxInfo.details,
    netPayout: commission.confectionerPayout - taxInfo.tax,
    escrowHoldHours: ESCROW.holdHours,
    legalStatus: confectioner.legalInfo.status,
  };
}

// Расчёт стоимости доставки
export function calculateDelivery(
  orderAmount: number,
  isExpress: boolean = false,
  distanceKm: number = 0,
  inZone: boolean = true
): { cost: number; details: string } {
  // Бесплатная доставка при заказе от 3000₽ и в зоне
  if (orderAmount >= DELIVERY.freeFrom && inZone) {
    return { cost: 0, details: "Бесплатно (от 3000₽ в зоне доставки)" };
  }
  if (isExpress) {
    return { cost: DELIVERY.expressCost, details: "Экспресс (3 часа)" };
  }
  if (!inZone && distanceKm > 0) {
    // Вне зоны — оплата за км
    const cost = DELIVERY.baseCost + distanceKm * DELIVERY.extendedPerKm;
    return {
      cost,
      details: `${DELIVERY.baseCost}₽ + ${distanceKm}км × ${DELIVERY.extendedPerKm}₽`,
    };
  }
  return { cost: DELIVERY.baseCost, details: "Базовая стоимость" };
}

// Определение уровня лояльности
export function getLoyaltyLevel(totalSpent: number): keyof typeof LOYALTY {
  if (totalSpent >= LOYALTY.PLATINUM.minSpent) return "PLATINUM";
  if (totalSpent >= LOYALTY.GOLD.minSpent) return "GOLD";
  if (totalSpent >= LOYALTY.SILVER.minSpent) return "SILVER";
  return "BRONZE";
}

// Начисление бонусов
export function calculateBonusPoints(
  amount: number,
  level: keyof typeof LOYALTY = "BRONZE"
): number {
  // 1 балл за каждые 100 рублей, умноженный на коэффициент уровня
  return Math.floor(amount / 100) * LOYALTY[level].multiplier;
}

// Форматирование валюты
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Форматирование даты
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// Статусы заказов
export const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Ожидает подтверждения", color: "bg-amber-100 text-amber-800 border-amber-200" },
  CONFIRMED: { label: "Подтверждён", color: "bg-blue-100 text-blue-800 border-blue-200" },
  IN_PROGRESS: { label: "В работе", color: "bg-purple-100 text-purple-800 border-purple-200" },
  READY: { label: "Готов", color: "bg-green-100 text-green-800 border-green-200" },
  DELIVERING: { label: "Доставляется", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  COMPLETED: { label: "Завершён", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  CANCELLED: { label: "Отменён", color: "bg-red-100 text-red-800 border-red-200" },
  DISPUTE: { label: "Спор", color: "bg-orange-100 text-orange-800 border-orange-200" },
};

export const PAYMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает оплаты", color: "bg-amber-100 text-amber-800" },
  paid: { label: "Оплачен", color: "bg-blue-100 text-blue-800" },
  escrow: { label: "Эскроу", color: "bg-purple-100 text-purple-800" },
  released: { label: "Выплачен", color: "bg-emerald-100 text-emerald-800" },
  refunded: { label: "Возврат", color: "bg-red-100 text-red-800" },
};

// Траст-уровни кондитера
export const TRUST_LEVELS: Record<string, { label: string; color: string; description: string }> = {
  NEW: { label: "Новичок", color: "bg-slate-100 text-slate-800", description: "Менее 10 заказов" },
  // VERIFIED — имя из DB enum TrustLevel (миграция 0016b); TRUSTED — legacy mock-имя. Это синонимы.
  VERIFIED: { label: "Проверенный", color: "bg-blue-100 text-blue-800", description: "Более 30 заказов, рейтинг 4.5+" },
  TRUSTED: { label: "Проверенный", color: "bg-blue-100 text-blue-800", description: "Более 30 заказов, рейтинг 4.5+" },
  EXPERT: { label: "Эксперт", color: "bg-purple-100 text-purple-800", description: "Более 100 заказов, рейтинг 4.8+" },
  MASTER: { label: "Мастер", color: "bg-amber-100 text-amber-800", description: "Более 500 заказов, рейтинг 4.9+" },
};

// Опции транспорта курьера
export const COURIER_TRANSPORT: Record<string, { label: string; icon: string; maxWeight: number; speed: string }> = {
  foot: { label: "Пешком", icon: "🚶", maxWeight: 5, speed: "медленно" },
  bicycle: { label: "Велосипед", icon: "🚲", maxWeight: 8, speed: "быстро" },
  motorbike: { label: "Мотоцикл", icon: "🏍️", maxWeight: 15, speed: "очень быстро" },
  car: { label: "Автомобиль", icon: "🚗", maxWeight: 30, speed: "быстро" },
  van: { label: "Газель", icon: "🚐", maxWeight: 1000, speed: "средне" },
};

// ===== СПОСОБЫ ОПЛАТЫ И РАССРОЧКА =====
import type {
  InstallmentPlan,
  PaymentFilterOption,
  Product,
} from "./types";

// Информация о способах оплаты для отображения
export const PAYMENT_METHOD_INFO: Record<
  string,
  { label: string; shortLabel: string; icon: string; color: string; description: string }
> = {
  card: {
    label: "Банковская карта",
    shortLabel: "Карта",
    icon: "💳",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    description: "Visa, Mastercard, Мир",
  },
  sbp: {
    label: "Система быстрых платежей",
    shortLabel: "СБП",
    icon: "⚡",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    description: "Перевод по QR-коду",
  },
  cash: {
    label: "Наличные",
    shortLabel: "Наличные",
    icon: "💵",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    description: "Оплата при получении",
  },
  split: {
    label: "Разделить платёж",
    shortLabel: "Сплит",
    icon: "🔀",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    description: "Между несколькими людьми",
  },
  installment: {
    label: "Рассрочка",
    shortLabel: "Рассрочка",
    icon: "📅",
    color: "bg-rose-100 text-rose-800 border-rose-200",
    description: "Оплата частями",
  },
  escrow: {
    label: "Эскроу-счёт",
    shortLabel: "Эскроу",
    icon: "🛡️",
    color: "bg-indigo-100 text-indigo-800 border-indigo-200",
    description: "Безопасная оплата, холдирование 24 часа",
  },
};

// Партнёры рассрочки
export const INSTALLMENT_PROVIDERS: Record<
  string,
  { label: string; shortLabel: string; icon: string; color: string; website: string }
> = {
  split: {
    label: "Сплит (Тинькофф)",
    shortLabel: "Сплит",
    icon: "🔀",
    color: "bg-yellow-100 text-yellow-800",
    website: "split.tinkoff.ru",
  },
  tinkoff: {
    label: "Тинькофф Рассрочка",
    shortLabel: "Тинькофф",
    icon: "🟡",
    color: "bg-yellow-100 text-yellow-800",
    website: "tinkoff.ru",
  },
  sberbank: {
    label: "СберРассрочка",
    shortLabel: "Сбер",
    icon: "🟢",
    color: "bg-green-100 text-green-800",
    website: "sberbank.ru",
  },
  alfa: {
    label: "Альфа-Банк Рассрочка",
    shortLabel: "Альфа",
    icon: "🔴",
    color: "bg-red-100 text-red-800",
    website: "alfabank.ru",
  },
  vtb: {
    label: "ВТБ Рассрочка",
    shortLabel: "ВТБ",
    icon: "🔵",
    color: "bg-blue-100 text-blue-800",
    website: "vtb.ru",
  },
  internal: {
    label: "Рассрочка от кондитера",
    shortLabel: "Напрямую",
    icon: "🤝",
    color: "bg-purple-100 text-purple-800",
    website: "",
  },
};

// Получить доступные способы оплаты для товара (с учётом настроек кондитера)
export function getProductPaymentOptions(
  product: Product,
  confectioner?: Confectioner
): {
  card: boolean;
  sbp: boolean;
  cash: boolean;
  split: boolean;
  installment: boolean;
  installments: InstallmentPlan[];
  escrow: boolean;
} {
  const productOpts = product.paymentOptions;
  const confectionerSettings = confectioner?.paymentSettings;

  // Если у товара указаны свои настройки — используем их
  // Иначе наследуем от кондитера
  const card = productOpts?.acceptCard ?? confectionerSettings?.acceptCard ?? true;
  const sbp = productOpts?.acceptSbp ?? confectionerSettings?.acceptSbp ?? true;
  const cash = productOpts?.acceptCash ?? confectionerSettings?.acceptCash ?? false;
  const split = productOpts?.acceptSplit ?? confectionerSettings?.acceptSplit ?? false;
  const installment =
    (productOpts?.acceptInstallment ?? confectionerSettings?.acceptInstallment ?? false) &&
    product.price >= (confectionerSettings?.installmentMinAmount ?? 0);

  // Доступные варианты рассрочки
  let installments: InstallmentPlan[] = [];
  if (installment && confectionerSettings?.installmentPlans) {
    const availableIds = productOpts?.availableInstallments;
    installments = confectionerSettings.installmentPlans.filter((plan) => {
      if (!plan.isActive) return false;
      if (availableIds && !availableIds.includes(plan.id)) return false;
      if (product.price < plan.minAmount) return false;
      if (plan.maxAmount && product.price > plan.maxAmount) return false;
      return true;
    });
  }

  return {
    card,
    sbp,
    cash,
    split,
    installment: installments.length > 0,
    installments,
    escrow: true, // эскроу всегда
  };
}

// Проверить, поддерживает ли товар фильтр-опцию оплаты
export function productMatchesPaymentFilter(
  product: Product,
  confectioner: Confectioner | undefined,
  option: PaymentFilterOption
): boolean {
  const opts = getProductPaymentOptions(product, confectioner);
  switch (option) {
    case "card":
      return opts.card;
    case "sbp":
      return opts.sbp;
    case "cash":
      return opts.cash;
    case "split":
      return opts.split;
    case "escrow":
      return opts.escrow;
    case "installment_0":
      return opts.installments.some((p) => p.interestRate === 0);
    case "installment_3":
      return opts.installments.some((p) => p.months >= 3);
    case "installment_6":
      return opts.installments.some((p) => p.months >= 6);
    default:
      return false;
  }
}

// Расчёт ежемесячного платежа по рассрочке
export function calculateInstallmentPayment(
  totalAmount: number,
  plan: InstallmentPlan
): {
  downPayment: number; // первый взнос
  remainingAmount: number; // остаток
  monthlyPayment: number; // ежемесячный платёж
  totalToPay: number; // всего к оплате с переплатой
  overpayment: number; // переплата
} {
  const downPayment = Math.round((totalAmount * plan.downPaymentPercent) / 100);
  const remainingAfterDown = totalAmount - downPayment;
  const interest = Math.round((remainingAfterDown * plan.interestRate) / 100);
  const totalToPay = totalAmount + interest;
  const remainingAmount = totalToPay - downPayment;
  const monthlyPayment = Math.round(remainingAmount / plan.months);
  return {
    downPayment,
    remainingAmount,
    monthlyPayment,
    totalToPay,
    overpayment: interest,
  };
}

// Форматирование варианта рассрочки для карточки товара
export function formatInstallmentPlan(plan: InstallmentPlan, amount: number): string {
  const calc = calculateInstallmentPayment(amount, plan);
  if (plan.interestRate === 0) {
    return `${plan.months} мес по ${formatCurrency(calc.monthlyPayment)}`;
  }
  return `${plan.months} мес по ${formatCurrency(calc.monthlyPayment)} (+${formatCurrency(calc.overpayment)})`;
}

// Форматирование относительного времени ("2 минуты назад", "через 3 часа")
export function formatRelative(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3600000);
  const diffD = Math.round(diffMs / 86400000);

  if (diffMs < 0) {
    // Past
    if (diffMin > -1) return "только что";
    if (diffMin > -60) return `${Math.abs(diffMin)} мин назад`;
    if (diffH > -24) return `${Math.abs(diffH)} ч назад`;
    if (diffD > -30) return `${Math.abs(diffD)} дн назад`;
    return formatDate(date);
  } else {
    // Future
    if (diffMin < 60) return `через ${diffMin} мин`;
    if (diffH < 24) return `через ${diffH} ч`;
    if (diffD < 30) return `через ${diffD} дн`;
    return formatDate(date);
  }
}
