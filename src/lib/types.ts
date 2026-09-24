// Типы данных платформы "Кондитера"

export type Role =
  | "GUEST"
  | "CUSTOMER"
  | "CONFECTIONER"
  | "SUPPLIER"
  | "COURIER"
  | "ADMIN"
  | "MODERATOR"
  | "SUPPORT"
  | "STUDIO"
  | "COPYWRITER"
  | "FOOD_SERVICE"
  | "EVENT_ORGANIZER"
  | "BLOGGER"
  | "PICKUP_POINT"
  | "WHOLESALER"
  | "TASTER"
  | "FRANCHISEE"
  | "NUTRITIONIST"
  | "CORPORATE_CLIENT"
  | "QUALITY_INSPECTOR"
  | "CERTIFICATION_AGENT"
  | "SUPER_ADMIN"
  | "VENUE_OWNER"
  | "ANIMATOR_AGENCY"
  | "RECREATION_CENTER"
  | "KIDS_CLUB"
  | "INSPECTOR";

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  roles: Role[];
  createdAt: string;
  // Профильные поля
  city?: string;
  loyaltyLevel?: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
  bonusBalance?: number;
  // Тип покупателя: физлицо или юрлицо
  accountType?: "individual" | "legal";
  // Реквизиты юрлица (если accountType === "legal")
  legalInfo?: UserLegalInfo;
  // Статус блокировки
  isBlocked?: boolean;
  blockedReason?: string;
  blockedAt?: string;
}

// Реквизиты юрлица для покупателя
export interface UserLegalInfo {
  // Тип организации
  type: "IP" | "OOO" | "PAO" | "NAO" | "FKUP" | "GUP" | "OTHER";
  // Название
  companyName: string;
  fullName?: string; // полное наименование
  // Реквизиты
  inn: string; // ИНН (10 для юрлица, 12 для ИП)
  kpp?: string; // КПП (только для ООО)
  ogrn?: string; // ОГРН (13) или ОГРНИП (15)
  // Адрес
  legalAddress: string;
  postalAddress?: string;
  // Банк
  bankAccount?: string; // расчётный счёт
  bankBik?: string;
  bankName?: string;
  correspondentAccount?: string;
  // Контакт
  ceoName?: string; // ФИО руководителя
  ceoPosition?: string; // должность
  ceoBasis?: string; // действует на основании (Устава, доверенности)
  accountingEmail?: string; // email бухгалтерии
  accountingPhone?: string;
  // Система налогообложения
  taxSystem?: "OSNO" | "USN_6" | "USN_15" | "VAT";
  hasVat?: boolean; // работает с НДС
  // Документы
  documentsVerified?: boolean;
  verifiedAt?: string;
}

// ===== СОГЛАСОВАНИЕ ЗАКАЗА (NEGOTIATION) =====
// После конструктора → кондитер корректирует → покупатель одобряет → оплата
export type NegotiationStatus =
  | "pending_confectioner" // ждёт реакции кондитера
  | "quoted" // кондитер отправил предложение
  | "pending_customer" // ждёт реакции покупателя
  | "approved" // покупатель одобрил → можно оплатить
  | "rejected" // покупатель отклонил
  | "expired" // срок истёк
  | "revised"; // кондитер пересмотрел (после отклонения покупателем)

export interface NegotiationItem {
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: "cake" | "filling" | "coating" | "decoration" | "service" | "delivery" | "other";
}

export interface OrderNegotiation {
  id: string;
  // Связи
  inquiryId?: string; // связь с заявкой из конструктора
  customerId: string;
  customerName: string;
  customerAvatar?: string;
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar?: string;
  // Исходные данные (от покупателя)
  originalRequest: {
    eventType: string;
    base: string;
    filling: string;
    coating: string;
    decorations: string[];
    servings: number;
    city: string;
    deliveryDate: string;
    deliveryType: string;
    inscription?: string;
    comment?: string;
    estimatedPrice: number;
  };
  // Предложение кондитера (корректировка)
  quotedItems: NegotiationItem[];
  quotedTotal: number;
  quotedComment?: string; // комментарий кондитера
  quotedDeliveryCost: number;
  quotedPrepTime: string;
  quotedAt?: string;
  // Согласование
  status: NegotiationStatus;
  customerResponse?: "approved" | "rejected";
  customerComment?: string;
  customerRespondedAt?: string;
  // Запрос скидки
  discountRequested?: boolean;
  discountPercent?: number;
  discountComment?: string;
  // История изменений
  revisions: {
    id: string;
    at: string;
    by: "confectioner" | "customer";
    action: string;
    oldTotal?: number;
    newTotal?: number;
    comment?: string;
  }[];
  // Срок действия предложения
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
}
export type CorporateEventType =
  | "new_year" // Новый год
  | "christmas" // Рождество
  | "feb_23" // 23 февраля
  | "mar_8" // 8 марта
  | "easter" // Пасха
  | "may_1" // 1 мая
  | "may_9" // 9 мая
  | "russia_day" // 12 июня
  | "nov_4" // 4 ноября День народного единства
  | "knowledge_day" // 1 сентября
  | "company_anniversary" // годовщина компании
  | "office_party" // офисная вечеринка
  | "team_building" // тимбилдинг
  | "conference" // конференция
  | "client_event" // клиентское мероприятие
  | "corporate_gifts" // корпоративные подарки
  | "other";

export interface CorporateEvent {
  id: string;
  customerId: string;
  customerName: string;
  customerAvatar?: string;
  // Кто заказчик
  companyName: string;
  companyInn?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  // Событие
  type: CorporateEventType;
  title: string;
  description: string;
  // Детали
  eventDate: string;
  eventLocation: string;
  attendeesCount: number;
  budget: { min: number; max: number };
  // Что нужно
  neededItems: string[]; // торты, капкейки, подарки
  // Статус
  status: "draft" | "open" | "in_progress" | "completed" | "cancelled";
  // Отклики
  responsesCount: number;
  selectedConfectionerId?: string;
  // Даты
  createdAt: string;
  deadline: string; // срок подачи заявок
  // B2B особенности
  needsInvoice: boolean; // нужен счёт на оплату
  needsVatInvoice: boolean; // счёт-фактура с НДС
  needsAct: boolean; // акт выполненных работ
  needsContract: boolean; // договор
  paymentDeferred: boolean; // отсрочка платежа
  paymentDays?: number; // отсрочка в днях
}

// ===== ЧЁРНЫЙ СПИСОК =====
export type BlacklistReason =
  | "fraud" // мошенничество
  | "scam" // обман
  | "extortion" // вымогательство
  | "spam" // спам
  | "fake_reviews" // накрутка отзывов
  | "non_payment" // неоплата
  | "abuse" // оскорбления
  | "threats" // угрозы
  | "duplicate_account" // дубль-аккаунт
  | "violated_terms" // нарушение условий
  | "suspicious_activity" // подозрительная активность
  | "other";

export type BlacklistScope = "user" | "email" | "phone" | "ip" | "device" | "company";

export interface BlacklistEntry {
  id: string;
  // Что блокируем
  scope: BlacklistScope;
  value: string; // email/phone/ip/userId/inn
  userId?: string;
  // Причина
  reason: BlacklistReason;
  reasonDetails: string;
  // Доказательства
  evidence?: string[]; // ссылки на скриншоты, переписки
  // Кто заблокировал
  blockedBy: string;
  blockedAt: string;
  // Срок
  isPermanent: boolean;
  expiresAt?: string;
  // Статус
  status: "active" | "expired" | "appealed" | "lifted";
  // Жалобы/апелляции
  appeals?: {
    id: string;
    text: string;
    createdAt: string;
    status: "pending" | "approved" | "rejected";
  }[];
  // Связанные заказы/чаты
  relatedOrderIds?: string[];
  relatedChatIds?: string[];
}

// ===== МАГАЗИНЫ ДЕКОРА И УПАКОВКИ =====
export type DecorCategory =
  | "candles" // свечи
  | "toppers" // топперы
  | "boards" // подложки
  | "boxes" // коробки
  | "ribbon" // ленты
  | "sparklers" // бенгальские огни
  | "figures" // фигурки
  | "flowers" // цветы (искусственные/живые)
  | "packaging" // упаковка
  | "tools" // инструменты
  | "gift_cards" // подарочные карты
  | "other";

export interface DecorShop {
  id: string;
  businessName: string;
  description: string;
  avatar: string;
  cover?: string;
  city: string;
  rating: number;
  reviewsCount: number;
  // Доставка по России или только свой город
  shipsNationwide: boolean;
  deliveryCities?: string[];
  // Минимальный заказ
  minOrder: number;
  // Категории
  categories: DecorCategory[];
  // Верификация
  verified: boolean;
  // Скидка для покупателей платформы
  platformDiscount?: number; // %
}

export interface DecorProduct {
  id: string;
  shopId: string;
  shopName: string;
  shopAvatar?: string;
  title: string;
  description: string;
  category: DecorCategory;
  price: number;
  oldPrice?: number;
  images: string[];
  // Характеристики
  material?: string;
  color?: string;
  size?: string;
  // Количество в наборе
  packQuantity?: number;
  // Многоразовое?
  reusable?: boolean;
  // Персонализация (гравировка, надпись)
  customizable?: boolean;
  // Связь с праздниками
  suitableFor?: string[]; // ["birthday", "wedding", "new_year"]
  // Рейтинг
  rating: number;
  reviewsCount: number;
  // Метрики
  isPopular?: boolean;
  isNew?: boolean;
  // Связь с тортами (cross-sell)
  crossSellWith?: string[]; // id продуктов-тортов
  inStock: number;
}

// ===== УМНЫЕ ПОДБОРКИ (CROSS-SELL / UP-SELL) =====
export type CrossSellType =
  | "frequently_bought" // "С этим товаром покупают"
  | "similar_taste" // "Похожие вкусы"
  | "complete_the_look" // "Дополните образ"
  | "bundle_offer" // "Выгодный набор"
  | "seasonal_match" // "Сезонное сочетание"
  | "occasion_match"; // "Для этого праздника"

export interface ProductBundle {
  id: string;
  name: string;
  description: string;
  // Товары в наборе
  items: {
    productId: string;
    productType: "cake" | "decor" | "packaging";
    title: string;
    image: string;
    price: number;
    quantity: number;
  }[];
  // Цена набора (может быть дешевле суммы)
  bundlePrice: number;
  originalPrice: number; // сумма отдельных товаров
  discount: number; // % скидки
  // Изображение
  image?: string;
  // Связанный торт (для какого торта подходит)
  mainProductId?: string;
  // Для какого праздника
  suitableFor?: string;
  // Метрики
  soldCount: number;
  rating: number;
}

// ===== МАГАЗИНЫ УСЛУГ (ФЕЙЕРВЕРКИ, ШАРЫ, АНИМАТОРЫ) =====
export type ServiceCategory =
  | "fireworks_indoor" // холодные фейерверки для помещения
  | "fireworks_outdoor" // уличные салюты
  | "fireworks_stage" // сценические
  | "balloons_helium" // гелиевые шары
  | "balloons_composition" // композиции из шаров
  | "balloons_arch" // арки из шаров
  | "balloons_release" // запуск шаров
  | "animator_clown" // клоуны
  | "animator_hero" // сказочные герои
  | "animator_show" // шоу-программы
  | "animator_facepaint" // аквагрим
  | "animator_quest" // квесты
  | "photographer" // фотограф
  | "videographer" // видеограф
  | "music" // музыканты, диджей
  | "host" // ведущий
  | "print_gingerbread" // печать на пряниках
  | "print_sugar_paper" // печать на сахарной бумаге
  | "print_rice_paper" // печать на рисовой бумаге
  | "print_wafer_paper" // печать на вафельной бумаге
  | "print_chocolate" // печать на шоколаде
  | "print_icing_sheet" // печать на глазурной бумаге
  | "print_custom_cookie" // печать на пряниках/печенье
  | "print_edible_stickers" // съедобные наклейки
  | "print_design" // печать по дизайну
  | "other";

export type ServiceUnit = "hour" | "item" | "set" | "event" | "sqm" | "sheet";

export interface ServiceShop {
  id: string;
  businessName: string;
  description: string;
  avatar: string;
  cover?: string;
  city: string;
  region?: string;
  rating: number;
  reviewsCount: number;
  // Доставка по России или только свой город (для фейерверков и шаров)
  shipsNationwide: boolean;
  deliveryCities?: string[];
  // Для аниматоров — выезд
  serviceRadiusKm?: number;
  // Минимальный заказ
  minOrder: number;
  // Категории
  categories: ServiceCategory[];
  // Верификация
  verified: boolean;
  // Скидка для покупателей платформы
  platformDiscount?: number; // %
  // Контакты
  phone?: string;
  website?: string;
}

export interface ServiceProduct {
  id: string;
  shopId: string;
  shopName: string;
  shopAvatar?: string;
  title: string;
  description: string;
  category: ServiceCategory;
  price: number;
  oldPrice?: number;
  // Цена за (единицу, час, штуку)
  priceUnit: "item" | "hour" | "set" | "event" | "sqm" | "sheet";
  images: string[];
  // Характеристики
  duration?: string; // длительность услуги (2 часа, весь вечер)
  // Для фейерверков
  durationSeconds?: number; // длительность салюта в секундах
  shotsCount?: number; // количество залпов
  // Для шаров
  balloonsCount?: number; // количество шаров
  // Для аниматоров
  ageRange?: string; // 3-7 лет
  programDuration?: number; // минут
  // Персонализация
  customizable?: boolean;
  // Связь с праздниками
  suitableFor?: string[];
  // Рейтинг
  rating: number;
  reviewsCount: number;
  // Метрики
  isPopular?: boolean;
  isNew?: boolean;
  // Связь с тортами (cross-sell)
  crossSellWith?: string[];
  // Доступность
  inStock: number; // для товаров
  available: boolean; // для услуг (аниматоры могут быть заняты)
  // Безопасность (для фейерверков)
  safetyNote?: string;
  // Портфолио
  portfolioImages?: string[];
  // Локации (города/адреса), где оказывается услуга печати
  locations?: string[];
  // Варианты цен (несколько тарифов предложения)
  priceOffers?: {
    name: string;        // "1 пряник", "Опт от 10 шт", "Срочный заказ"
    price: number;
    unit?: string;       // "шт.", "лист", "набор"
    description?: string;
  }[];
  // Срок изготовления
  productionTime?: string;
}
export interface SemaphoreEntry {
  id: string;
  type: "email" | "phone";
  value: string;
  userId: string;
  verified: boolean;
  // Метаданные
  ip?: string;
  deviceFingerprint?: string;
  registeredAt: string;
  // Попытки регистрации (для антифрода)
  attempts: number;
  lastAttemptAt?: string;
}


export type ProductCategory =
  | "cakes"
  | "cupcakes"
  | "pastries"
  | "cookies"
  | "chocolate"
  | "macarons"
  | "bento"
  | "desserts"
  | "zephyr_bouquets"    // Зефирные букеты
  | "pies"               // Пироги
  | "patties"            // Пирожки
  | "rolls"              // Рулеты
  | "healthy"            // ПП изделия
  | "pastila"            // Пастила
  | "oriental_sweets"    // Рахат лукум, чак-чак
  | "candies"            // Конфеты
  | "marmalade"          // Мармелад
  | "lollipops"          // Леденцы
  | "gingerbread"        // Пряники
  | "realistic_cakes";   // Реалистичные пирожные

export interface Product {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  oldPrice?: number;
  category: ProductCategory;
  subcategory?: string;
  customizable?: boolean;
  suitableFor?: string[];
  available?: boolean;
  ecoBadges?: string[];
  bulkPrices?: { quantity: number; price: number }[];
  addons?: string[];
  basePrice?: number;
  images: string[];
  confectionerId: string;
  confectionerName?: string;
  confectionerAvatar?: string;
  rating: number;
  reviewsCount: number;
  weight?: string;
  servings?: number;
  prepTime?: string;
  isPopular?: boolean;
  isNew?: boolean;
  isHit?: boolean;
  tags?: string[];
  // Кастомизация
  fillings?: { name: string; priceModifier: number }[];
  coatings?: { name: string; priceModifier: number }[];
  decorations?: { name: string; priceModifier: number }[];
  // Способы оплаты, доступные для этого товара
  // (наследуются от кондитера, но могут быть переопределены)
  paymentOptions?: ProductPaymentOptions;
  // AR / 3D preview
  modelUrl?: string;      // GLB/GLTF URL for 3D + AR preview (Android/Chrome via Scene Viewer)
  modelUsdzUrl?: string;  // USDZ URL for iOS Quick Look
  // Состав продукта (из чего состоит)
  composition?: {
    ingredients: string[];        // основные ингредиенты ("Мука пшеничная", "Сахар", "Масло сливочное 82.5%")
    allergens: string[];          // аллергены ("Глютен", "Молоко", "Яйца", "Орехи")
    nutritionalValue?: {          // КБЖУ на 100г
      calories?: number;         // ккал
      protein?: number;          // белки, г
      fat?: number;              // жиры, г
      carbs?: number;            // углеводы, г
    };
    storageConditions?: string;   // условия хранения ("Хранить при температуре 2-6°C не более 48 часов")
    shelfLife?: string;           // срок годности ("48 часов с момента изготовления")
  };
  // Дополнительные изображения (детали, разрез, упаковка)
  detailImages?: string[];
  arEnabled?: boolean;
  // Видимость товара (админ может скрыть товар платформы)
  isHidden?: boolean;
  hiddenReason?: string;
  hiddenAt?: string;
  // Наличие на складе (для готовых изделий)
  inStock?: number | boolean;
}

// ===== СПОСОБЫ ОПЛАТЫ И РАССРОЧКА =====
// Кондитер настраивает какие способы оплаты он принимает
export interface ConfectionerPaymentSettings {
  // Карта / СБП / Наличные
  acceptCard: boolean;
  acceptSbp: boolean;
  acceptCash: boolean;
  acceptSplit: boolean; // СБП (split между несколькими)
  // Эскроу всегда включён
  // Рассрочка
  acceptInstallment: boolean;
  installmentPlans: InstallmentPlan[]; // варианты рассрочки от кондитера
  // Минимальная сумма для рассрочки
  installmentMinAmount: number;
  // Партнёры рассрочки
  installmentProviders: ("split" | "tinkoff" | "sberbank" | "alfa" | "vtb")[];
}

// Вариант рассрочки — устанавливается кондитером
export interface InstallmentPlan {
  id: string;
  name: string; // "Рассрочка на 3 месяца"
  months: number; // количество месяцев
  // Процент (0 = беспроцентная, 5 = 5% сверху за весь срок)
  interestRate: number;
  // Минимальная сумма заказа
  minAmount: number;
  // Максимальная сумма заказа
  maxAmount?: number;
  // Первый взнос в процентах (0 = без первого взноса, 30 = 30% сразу)
  downPaymentPercent: number;
  // Партнёр
  provider: "split" | "tinkoff" | "sberbank" | "alfa" | "vtb" | "internal";
  // Описание для покупателей
  description?: string;
  // Активна ли эта рассрочка
  isActive: boolean;
}

// Способы оплаты конкретного товара (наследуются или переопределяются)
export interface ProductPaymentOptions {
  // Какие способы принимает кондитер для этого товара
  acceptCard?: boolean;
  acceptSbp?: boolean;
  acceptCash?: boolean;
  acceptSplit?: boolean;
  acceptInstallment?: boolean;
  // Доступные варианты рассрочки (id из ConfectionerPaymentSettings.installmentPlans)
  availableInstallments?: string[];
}

// Способы оплаты в каталоге (для фильтра)
export type PaymentFilterOption =
  | "card" // банковская карта
  | "sbp" // СБП
  | "cash" // наличные
  | "installment_0" // беспроцентная рассрочка
  | "installment_3" // рассрочка на 3+ месяца
  | "installment_6" // рассрочка на 6+ месяцев
  | "split" // разделить платёж
  | "escrow"; // эскроу (всегда)

// Юридический статус (для кондитера, поставщика, курьера)
export type LegalStatus = "NPD" | "IP" | "OOO" | "PHYSICAL";

// Локация — адрес + гео + зона доставки
export interface Location {
  country: string;
  region: string; // субъект РФ (Москва, Тульская обл., ...)
  city: string;
  district?: string; // район города
  street?: string;
  house?: string;
  apartment?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
  // Зона обслуживания (для кондитеров — куда доставляют, для курьеров — где работают)
  serviceRadiusKm?: number; // радиус доставки в км
  deliveryCities?: string[]; // доп. города куда доставляют
}

// Юридические реквизиты — зависят от статуса
export interface LegalInfo {
  status: LegalStatus;
  // НПД (самозанятый)
  inn?: string; // ИНН физлица (12 цифр) — обязателен для НПД
  npdRegisteredAt?: string; // дата регистрации в качестве плательщика НПД
  // ИП
  ipOgrnip?: string; // ОГРНИП (15 цифр)
  ipInn?: string; // ИНН ИП (12 цифр)
  ipUsnRate?: "6%" | "15%"; // ставка УСН для ИП
  // ООО
  oooOgrn?: string; // ОГРН юрлица (13 цифр)
  oooInn?: string; // ИНН юрлица (10 цифр)
  oooKpp?: string; // КПП
  oooLegalAddress?: string; // юридический адрес
  oooTaxSystem?: "OSNO" | "USN_6" | "USN_15" | "VAT"; // система налогообложения ООО
  // Общие
  bankAccount?: string; // расчётный счёт
  bankBik?: string; // БИК банка
  bankName?: string;
  // Верификация документов (платформа подтверждает)
  documentsVerified?: boolean;
  verifiedAt?: string;
}

// ===== Точка дегустации (ресторан/кафе, где можно попробовать продукцию кондитера) =====
export interface TastingLocation {
  id: string;
  confectionerId: string;
  // Тип заведения
  type: "restaurant" | "cafe" | "bakery" | "coffee_shop" | "hotel" | "shop" | "food_court" | "canteen";
  typeLabel?: string;
  // Название заведения
  establishmentName: string;
  // Описание — что доступно
  description: string;
  // Какие товары доступны
  availableProducts: string[];
  // Контакт
  contactName?: string;
  contactPhone?: string;
  // Локация
  address: string;
  city: string;
  region?: string;
  lat?: number;
  lng?: number;
  // Метро/ориентир
  metroStation?: string;
  // Часы работы заведения
  workingHours?: string;
  // Средний чек заведения
  averageCheck?: number;
  // Фото заведения
  photo?: string;
  // Статус
  status: "active" | "inactive" | "pending";
  verified: boolean;
  // Время
  createdAt: string;
  updatedAt?: string;
}

export interface Confectioner {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  description: string;
  avatar: string;
  cover?: string;
  // Локация (полный адрес + гео)
  location: Location;
  // Совместимость со старым полем city
  city: string;
  rating: number;
  reviewsCount: number;
  ordersCount: number;
  verified: boolean;
  // Schema 0017 (camelCase): TrustLevel enum = 'NEW' | 'VERIFIED' | 'MASTER' | 'EXPERT'
  trustLevel: "NEW" | "VERIFIED" | "EXPERT" | "MASTER" | "TRUSTED";
  // Schema 0017: Tariff enum = 'START' | 'BASIC' | 'PREMIUM' | 'BUSINESS'
  // + 'PROFI' для обратной совместимости с mock-данными
  tariff: "START" | "BASIC" | "PREMIUM" | "BUSINESS" | "PROFI";
  // Юридический статус с реквизитами
  legalInfo: LegalInfo;
  // Schema 0017: TaxMode enum = 'NPD' | 'USN' | 'OSNO' | 'PSN' | 'SELF_EMPLOYED'
  // + 'IP' | 'OOO' для совместимости с mock-данными
  taxMode: "NPD" | "USN" | "OSNO" | "PSN" | "SELF_EMPLOYED" | "IP" | "OOO";
  specialization: string[];
  portfolioImages: string[];
  followersCount: number;
  responseTime: string;
  joinedAt: string;
  // Доставка
  selfPickup: boolean; // самовывоз
  deliveryOptions: ("own" | "courier" | "pickup_point" | "cdek")[]; // своя доставка / курьер платформы / ПВЗ / СДЭК
  // Настройки оплаты и рассрочки
  paymentSettings?: ConfectionerPaymentSettings;
  // Финансы (для дашборда)
  balance?: number;
  totalEarnings?: number;
  monthlyEarnings?: number;
}

export interface Supplier {
  id: string;
  businessName: string;
  description: string;
  avatar: string;
  // Локация склада
  location: Location;
  city: string;
  rating: number;
  minOrder: number;
  deliveryTime: string;
  categories: string[];
  // Юридический статус
  legalInfo: LegalInfo;
  // Доставка
  deliveryRegions: string[]; // регионы России куда возят
  deliveryOptions: ("own" | "cdek" | "boxberry" | "pickup_point")[];
}

export interface Courier {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  phone: string;
  // Локация — где работает курьер
  location: Location;
  city: string;
  // Юридический статус
  legalInfo: LegalInfo;
  // Транспорт
  transport: "foot" | "bicycle" | "motorbike" | "car" | "van";
  maxWeightKg: number; // максимальный вес доставки
  // Зона работы
  serviceRadiusKm: number;
  workingHours: { from: string; to: string };
  workingDays: number[]; // 0..6 (вс..сб)
  // Статус
  isOnline: boolean;
  rating: number;
  deliveriesCount: number;
  // Финансы
  balance: number;
  earningsToday: number;
  earningsMonth: number;
  earningsTotal: number;
  // Тариф
  earningsPerDelivery: number;
  verified: boolean;
}

// ===== АКЦИИ (PROMOTIONS) =====
export type PromotionType =
  | "discount_percent" // скидка N%
  | "discount_fixed" // скидка N₽
  | "free_delivery" // бесплатная доставка
  | "gift" // подарок
  | "bundle" // набор со скидкой
  | "early_booking" // раннее бронирование
  | "loyalty_bonus" // множитель бонусов
  | "happy_hours" // счастье-часы (временная скидка)
  | "first_order" // скидка на первый заказ
  | "holiday"; // праздничная акция

export type PromotionStatus = "draft" | "active" | "paused" | "expired" | "scheduled";

export interface Promotion {
  id: string;
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar?: string;
  title: string;
  description: string;
  type: PromotionType;
  // Значение акции
  value?: number; // процент или рубли
  // Промокод (опционально)
  promoCode?: string;
  // Условия
  minOrderAmount?: number;
  applicableProducts?: string[]; // id продуктов
  applicableCategories?: string[];
  // Сроки
  startDate: string;
  endDate: string;
  // Регион (если null — все города кондитера)
  cities?: string[];
  regions?: string[];
  // Лимиты
  maxUsageCount?: number;
  usedCount: number;
  maxPerUser?: number;
  // Статус
  status: PromotionStatus;
  // Платное продвижение
  isPromoted: boolean; // показ всплывающей рекламы
  promotedUntil?: string;
  promotedRegions?: string[]; // регионы для продвижения
  promotionBudget?: number; // бюджет продвижения
  // Изображение
  image?: string;
  // Создание
  createdAt: string;
  // Метрики
  views: number;
  clicks: number;
  conversions: number; // сколько раз использовали
}

// ===== РЕЦЕПТЫ И УРОКИ =====
export type RecipeType = "recipe" | "master_class" | "video_lesson" | "article";
export type RecipeDifficulty = "easy" | "medium" | "hard" | "expert";
export type RecipeAccess = "free" | "paid" | "subscription";

export interface Recipe {
  id: string;
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar?: string;
  type: RecipeType;
  title: string;
  description: string;
  // Содержание
  coverImage: string;
  images?: string[];
  videoUrl?: string;
  // Время
  prepTime: number; // минут
  cookTime: number; // минут
  totalTime: number; // минут
  // Сложность
  difficulty: RecipeDifficulty;
  // Порции
  servings: number;
  // Ингредиенты
  ingredients: {
    name: string;
    amount: string;
    unit: string;
  }[];
  // Шаги
  steps: {
    title: string;
    description: string;
    image?: string;
  }[];
  // Советы
  tips?: string[];
  // Теги
  tags: string[];
  category: string;
  // Доступ
  access: RecipeAccess;
  price?: number; // если платный
  // Метрики
  views: number;
  likes: number;
  comments: number;
  // Статус
  published: boolean;
  publishedAt?: string;
  createdAt: string;
}

// ===== СКЛАДСКОЙ УЧЁТ =====
export type InventoryUnit = "kg" | "g" | "l" | "ml" | "pc" | "pack" | "box";

export interface InventoryItem {
  id: string;
  confectionerId: string;
  name: string;
  category: string; // мука, сахар, масло, ягоды, упаковка...
  unit: InventoryUnit;
  // Количество
  quantity: number;
  minQuantity: number; // минимальный остаток для уведомления
  // Цена
  costPerUnit: number; // себестоимость за единицу
  // Поставщик
  supplierId?: string;
  supplierName?: string;
  // Срок годности
  expiryDate?: string;
  // Локация на складе
  storageLocation?: string; // полка, стеллаж
  // Метрики
  lastRestocked?: string;
  createdAt: string;
  updatedAt: string;
}

// Движение по складу
export type StockMovementType =
  | "incoming" // поступление
  | "outgoing" // списание (на заказ)
  | "adjustment" // корректировка
  | "waste" // списание (брак/истечение срока)
  | "transfer"; // перемещение

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
  quantity: number;
  unit: InventoryUnit;
  // Причина
  reason?: string;
  orderId?: string;
  // Стоимость
  costPerUnit?: number;
  totalCost?: number;
  // Дата
  date: string;
  createdBy: string;
}

// ===== ТАБЛИЦА ГАНТА (ПРОИЗВОДСТВО) =====
export type ProductionStage =
  | "preparation" // подготовка ингредиентов
  | "baking" // выпечка
  | "cooling" // охлаждение
  | "assembling" // сборка
  | "decorating" // декорирование
  | "packaging" // упаковка
  | "delivery_prep" // подготовка к доставке
  | "completed"; // готово

export interface GanttTask {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  productName: string;
  // Этап производства
  stage: ProductionStage;
  stageLabel: string;
  // Временные рамки
  startDate: string; // ISO
  endDate: string; // ISO
  duration: number; // минут
  // Статус
  status: "pending" | "in_progress" | "completed" | "delayed" | "cancelled";
  progress: number; // 0-100
  // Исполнитель
  assignee?: string;
  // Зависимости
  dependsOn?: string[];
  // Цвет
  color: string;
  // Напоминание
  reminderAt?: string;
  reminderSent?: boolean;
}

// ===== НАПОМИНАНИЯ =====
export type ReminderType =
  | "order_deadline" // срок заказа
  | "restock" // пополнить склад
  | "expiry" // срок годности
  | "promotion_end" // конец акции
  | "review_request" // запрос отзыва
  | "payment"; // платёж

export interface Reminder {
  id: string;
  type: ReminderType;
  title: string;
  description: string;
  // Связь
  orderId?: string;
  itemId?: string;
  promotionId?: string;
  // Сроки
  dueDate: string;
  // Статус
  isRead: boolean;
  isDone: boolean;
  // Приоритет
  priority: "low" | "medium" | "high" | "urgent";
  // Создание
  createdAt: string;
}


export interface SupplierProduct {
  id: string;
  supplierId: string;
  title: string;
  description: string;
  price: number;
  unit: string;
  category: string;
  inStock: number;
  image: string;
  bulkPrices?: { quantity: number; price: number }[];
}

export type OrderStatus =
  | "PENDING"
  | "NEGOTIATING"
  | "CONFIRMED"
  | "PREPARING"
  | "IN_PROGRESS"
  | "READY"
  | "DELIVERING"
  | "COMPLETED"
  | "CANCELLED"
  | "DISPUTE"
  | "REFUNDED";

export interface OrderItem {
  productId: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  customization?: {
    filling?: string;
    coating?: string;
    decoration?: string;
    inscription?: string;
  };
}

export interface Order {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  confectionerId?: string;
  confectionerName?: string;
  courierId?: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  deliveryAddress?: string;
  deliveryDate: string;
  deliveryTime?: string;
  deliveryCost: number;
  createdAt: string;
  paymentMethod: "card" | "cash" | "split";
  paymentStatus: "pending" | "paid" | "escrow" | "released" | "refunded";
  comment?: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  createdAt: string;
  isSystem?: boolean;
  isOwn?: boolean;
  reactions?: { emoji: string; count: number }[];
  // === Bot / Auto-chat ===
  isBot?: boolean;
  botKind?: "welcome" | "order_status" | "faq" | "quick_reply" | "escalation" | "payment_reminder";
  quickReplies?: QuickReply[];
  // === Voice message ===
  voice?: {
    url: string;          // data:audio/webm;base64,... или URL
    durationSec: number;  // длительность в секундах
    waveform?: number[];  // массив амплитуд для визуализации (0..1)
  };
}

export interface QuickReply {
  label: string;
  action: string;
  payload?: any;
}

export interface ChatRoom {
  id: string;
  type: "direct" | "group" | "support" | "order";
  name: string;
  avatar?: string;
  participants: { id: string; name: string; avatar?: string }[];
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  orderId?: string;
}

export interface CartItem {
  productId: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  confectionerId: string;
  customization?: {
    filling?: string;
    coating?: string;
    decoration?: string;
    inscription?: string;
  };
}

export interface ChannelPost {
  id: string;
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar: string;
  image: string;
  caption: string;
  likes: number;
  comments: number;
  createdAt: string;
  liked?: boolean;
  // Комментарии к посту
  postComments?: ChannelComment[];
  // Множественные изображения
  images?: string[];
}

// Сторис кондитера (исчезают через 24 часа)
export interface ChannelStory {
  id: string;
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar: string;
  image: string;
  caption?: string;
  createdAt: string;
  expiresAt: string; // через 24 часа
  views: number;
  viewed?: boolean;
}

// Подписчик
export interface ChannelFollower {
  id: string;
  confectionerId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  followedAt: string;
  isFollowing: boolean; // mutual follow
}

// Комментарий к посту
export interface ChannelComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: string;
  likes: number;
  liked?: boolean;
}

// Конструктор тортов — 8 шагов
export interface CakeBuilderState {
  step: number; // 0..9 (0: тип, 1: событие, 2: основа, 2.5: ярусы/форма, 3: начинка, ...)
  // Шаг 0: Тип кондитерского изделия
  productType?: string;
  // Шаг 1: Тип мероприятия
  eventType?: string;
  // Шаг 2: Основа
  base?: string;
  // Шаг 2.5: Ярусы и форма (для тортов)
  tiers?: number;
  shape?: string;
  // Шаг 3: Начинка
  filling?: string;
  // Шаг 4: Покрытие
  coating?: string;
  // Шаг 5: Декор
  decorations: string[];
  // Шаг 6: Диетические предпочтения
  dietary: string[];
  // Шаг 7: Локация и доставка
  city?: string;
  deliveryDate?: string;
  deliveryType?: "delivery" | "pickup";
  address?: string;
  // Шаг 8: Резюме
  servings?: number;
  quantity?: number;
  inscription?: string;
  comment?: string;
}

// ===== КАЛЕНДАРЬ ПРАЗДНИКОВ ПОЛЬЗОВАТЕЛЯ =====
export interface UserHoliday {
  id: string;
  userId: string;
  title: string; // "День рождения Маши"
  type: "birthday" | "anniversary" | "wedding_anniversary" | "graduation" | "other";
  date: string; // ISO date
  recurring: boolean; // ежегодно
  personName?: string; // имя именинника
  relationship?: string; // "дочь", "муж", "коллега"
  // Напоминание
  reminderDays: number; // за сколько дней напомнить (7, 14, 30)
  reminderSent?: boolean;
  // История заказов
  pastOrderIds?: string[];
  notes?: string;
}

// ===== ПОДАРОЧНЫЕ СЕРТИФИКАТЫ =====
export interface GiftCertificate {
  id: string;
  code: string; // уникальный код
  // Номинал
  amount: number;
  // Кто подарил
  fromName: string;
  fromEmail: string;
  // Кому
  toName: string;
  toEmail: string;
  toPhone?: string;
  // Поздравление
  message?: string;
  // Дизайн
  design: "classic" | "birthday" | "wedding" | "new_year" | "floral";
  // Срок
  purchasedAt: string;
  expiresAt: string; // обычно 1 год
  // Статус
  status: "active" | "used" | "expired" | "refunded";
  usedAt?: string;
  usedAmount?: number; // сколько использовано
  remainingAmount?: number;
  // Способ доставки
  deliveryMethod: "email" | "sms" | "print";
  // Дата доставки (когда отправить)
  sendDate?: string;
  sentAt?: string;
}

// ===== РЕФЕРАЛЬНАЯ ПРОГРАММА =====
export interface Referral {
  id: string;
  userId: string;
  referralCode: string; // уникальный код
  referralLink: string;
  // Статистика
  totalInvited: number;
  activeReferrals: number; // сделали заказ
  totalEarned: number; // заработано с рефералов
  availableBalance: number; // доступно к выводу/использованию
  // Настройки
  rewardAmount: number; // сколько получает приглашённый
  rewardPercent: number; // % от заказов реферала
  // История
  history: ReferralHistoryEntry[];
}

export interface ReferralHistoryEntry {
  id: string;
  referredName: string;
  referredEmail: string;
  invitedAt: string;
  firstOrderAt?: string;
  orderAmount?: number;
  earnedAmount?: number;
  status: "invited" | "registered" | "ordered" | "inactive";
}

// ===== ЭКО-БЕЙДЖИ =====
export interface EcoBadge {
  type:
    | "biodegradable_packaging" // биоразлагаемая упаковка
    | "local_ingredients" // локальные ингредиенты
    | "organic" // органические продукты
    | "zero_waste" // zero waste
    | "no_preservatives" // без консервантов
    | "no_margarine" // без маргарина
    | "solar_power" // солнечная энергия
    | "carbon_offset" // компенсация CO2
    | "fair_trade" // справедливая торговля
    | "recyclable"; // перерабатываемые материалы
  label: string;
  icon: string;
  description: string;
  verified: boolean;
}

// ===== ВИДЕО-ОТЗЫВЫ =====
export interface VideoReview {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  videoUrl: string; // URL записи
  thumbnailUrl?: string;
  rating: number;
  text?: string;
  duration: number; // секунд
  createdAt: string;
  views: number;
  likes: number;
}

// ===== ТРЕКИНГ КУРЬЕРА =====
export interface CourierTracking {
  orderId: string;
  orderNumber: string;
  courierId: string;
  courierName: string;
  courierAvatar?: string;
  courierPhone: string;
  // Текущая позиция
  currentLat: number;
  currentLng: number;
  // Маршрут
  routePoints: {
    lat: number;
    lng: number;
    timestamp: string;
    label?: string;
  }[];
  // Пункты
  pickupPoint: { lat: number; lng: number; label: string; arrived?: boolean };
  deliveryPoint: { lat: number; lng: number; label: string; arrived?: boolean };
  // ETA
  estimatedArrival: string; // ISO
  minutesLeft: number;
  // Статус
  status: "picked_up" | "en_route" | "nearby" | "arrived" | "delivered";
  // Транспорт
  transport: string;
  distanceKm: number;
  distanceLeftKm: number;
}

// Тип для навигации (single-page app)
export type ViewKey =
  | "home"
  | "catalog"
  | "product"
  | "confectioners"
  | "confectioner-profile"
  | "cake-builder"
  | "cart"
  | "checkout"
  | "supplier-shop"
  | "supplier-product"
  | "auth"
  | "blog"
  | "tenders"
  | "ready-made"
  | "promotions"
  | "recipes"
  | "recipe-detail"
  | "corporate-events"
  | "decor-shop"
  | "services-shop"
  | "gift-certificates"
  | "telegram-bot"
  | "search"
  | "about"
  | "legal"
  | "contacts"
  | "help"
  | "reviews"
  | "for-confectioners"
  | "for-suppliers"
  | "faq"
  | "dashboard-customer"
  | "dashboard-confectioner"
  | "dashboard-supplier"
  | "dashboard-courier"
  | "dashboard-admin"
  | "dashboard-moderator"
  | "dashboard-support"
  | "dashboard-copywriter"
  | "dashboard-food-service"
  | "dashboard-event-organizer"
  | "dashboard-blogger"
  | "dashboard-pickup-point"
  | "dashboard-wholesaler"
  | "dashboard-taster"
  | "dashboard-franchisee"
  | "dashboard-nutritionist"
  | "dashboard-corporate-client"
  | "dashboard-inspector"
  | "dashboard-certification-agent"
  | "dashboard-venue-owner"
  | "dashboard-studio"
  | "dashboard-extra"
  | "dashboard-quality-inspector"
  | "dashboard-animator-agency"
  | "dashboard-recreation-center"
  | "dashboard-kids-club"
  | "dashboard-recipe-developer"
  | "dashboard-loyalty-partner"
  | "chat";

export interface NavState {
  view: ViewKey;
  params?: Record<string, string>;
}

// ===== ПЛОЩАДКИ ДЛЯ ПРАЗДНИКОВ =====

export interface VenueVendor {
  id: string;
  venueId: string;
  vendorId: string;          // ID кондитера/продавца
  vendorName: string;
  vendorAvatar?: string;
  vendorType: "confectioner" | "catering" | "decorator" | "animator" | "photographer" | "other";
  placement: string;         // где именно размещён: "1 этаж, павильон 12", "фуд-корт зона B", и т.д.
  floor?: string;            // "1", "2", "цоколь"
  pavilion?: string;         // "A-12", "B-7"
  unit?: string;             // "стойка 5", "остров 3"
  contractStart?: string;    // дата начала размещения
  contractEnd?: string;      // дата окончания
  commissionPercent?: number; // комиссия площадки с продаж
  status: "active" | "pending" | "inactive";
  createdAt: string;
}

export interface Venue {
  id: string;
  ownerId: string;
  ownerName: string;
  businessName: string;
  slug: string;
  description: string;
  logo: string;
  coverImage: string;
  galleryImages: string[];
  // Локация
  country: string;
  region: string;
  city: string;
  district?: string;          // район/округ
  street: string;             // улица
  building: string;           // дом/корпус
  floor?: string;             // этаж здания
  pavilion?: string;          // павильон/зона
  unit?: string;              // офис/комната
  fullAddress: string;        // полный адрес одной строкой
  address?: string;           // краткий адрес
  postalCode?: string;
  lat?: number;
  lng?: number;
  // Характеристики
  venueType: string;
  venueTypeLabel: string;
  area: number;
  capacity: number;
  ageGroups: string[];
  amenities: string[];
  services: string[];
  workingHours: { days: string; from: string; to: string };
  phone: string;
  email: string;
  website?: string;
  // Метрики
  rating: number;
  reviewsCount: number;
  bookingsCount: number;
  verified: boolean;
  minOrder: number;
  platformDiscount: number;
  createdAt: string;
  status: "draft" | "published" | "archived";
}

export interface VenueService {
  id: string;
  venueId: string;
  venueName?: string;
  venueLogo?: string;
  title: string;
  description: string;
  category: string;
  categoryLabel?: string;
  price: number;
  priceUnit: "item" | "hour" | "set" | "event" | "sqm" | "rent";
  duration?: string;
  durationMinutes?: number;
  images?: string[];
  mainImage?: string;
  includes?: string[];
  groupSize?: string | { min: number; max: number };
  placement?: string;
  ageRestriction?: string | { min: number; max: number };
  suitableFor?: string[];
  rating?: number;
  reviewsCount?: number;
  bookingsCount?: number;
  isPopular?: boolean;
  isFeatured?: boolean;
  availability?: string;
  cancellationPolicy?: string;
  depositRequired?: boolean;
  depositPercent?: number;
  crossSellWith?: string[];
  safetyNote?: string;
  createdAt?: string;
  status?: "draft" | "published" | "archived" | "active" | "inactive";
  city?: string;
  featured?: boolean;
  available?: boolean;
  ecoBadges?: string[];
  bulkPrices?: { quantity: number; price: number }[];
  addons?: string[];
  basePrice?: number;
}

export interface PriceList {
  id: string;
  venueId?: string;
  ownerId?: string;
  ownerName?: string;
  ownerType?: string;
  title: string;
  description?: string;
  category?: string;
  validFrom?: string;
  validTo?: string;
  isActive?: boolean;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  status?: "draft" | "published" | "archived" | "active" | "inactive";
  items: {
    id?: string;
    priceListId?: string;
    serviceName?: string;
    name?: string;
    description?: string;
    category?: string;
    price: number;
    priceUnit?: string;
    duration?: string | number;
    minQuantity?: number;
    maxQuantity?: number;
    isAvailable?: boolean;
    notes?: string;
    venueServiceId?: string;
    unit?: string;
  }[];
}



// ===== РАБОТЫ КОНДИТЕРОВ (портфолио) =====
export interface ConfectionerWork {
  id: string;
  confectionerId: string;
  confectionerName: string;
  title: string;
  description?: string;
  mainImage: string;
  images?: string[];
  category: string;
  categoryLabel?: string;
  tags: string[];
  weight?: string;
  prepTime?: string;
  price?: number;
  priceLabel?: string;
  servings?: number;
  shape?: string;
  tiers?: number;
  filling?: string;
  coating?: string;
  decorations?: string[];
  fillings?: string[];
  eventType?: string;
  city?: string;
  views: number;
  likes: number;
  status: "draft" | "published" | "archived";
  featured: boolean;
  createdAt: string;
  updatedAt?: string;
}

// ===== FRAUD REPORTS =====
export type ReportType = "spam" | "fake_review" | "duplicate_account" | "suspicious_order" | "payment_fraud" | "other" | "fraud" | "scam" | "fake_product" | "non_delivery" | "non_payment" | "abuse" | "threats" | "fake_reviews" | "duplicate" | "suspicious" | "copyright";
export type ReportStatus = "open" | "investigating" | "resolved" | "false_positive" | "confirmed" | "new" | "assigned" | "closed" | "pending" | "reviewing" | "rejected" | "escalated";

export interface FraudReport {
  id: string;
  type: ReportType;
  status: ReportStatus;
  reportedBy: string;
  reporterName?: string;
  targetName?: string;
  reportedAt: string;
  targetUserId?: string;
  targetOrderId?: string;
  reason: string;
  description?: string;
  riskScore: number;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;
  urgency?: string;
  createdAt?: string;
  autoFlags?: number;
  evidence?: string[];
}

export interface FraudRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  threshold: number;
  action: "flag" | "block" | "notify" | "require_verification";
  points?: number;
  lastTriggered?: string;
  triggered?: boolean;
  triggeredCount?: number;
}
