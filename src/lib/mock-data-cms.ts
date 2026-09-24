// CMS mock-данные — контент сайта, редактируемый админом

// ===== СТРАНИЦЫ CMS =====
export const MOCK_CMS_PAGES = [
  {
    id: "cms_p1",
    slug: "about",
    title: "О платформе",
    content: `# Кондитера

Маркетплейс кондитерских изделий от домашних кондитеров и кондитерских ателье по всей России.

Мы создали платформу, которая объединяет талантливых кондитеров из разных уголков России с покупателями, ценящими ручную работу и натуральные ингредиенты.

**Наша миссия** — сделать заказ домашнего торта таким же простым, как заказ пиццы, но с качеством и душой ручной работы.

**Что мы предлагаем:**
- 2 400+ проверенных кондитеров
- Конструктор тортов в 8 шагов
- Безопасные платежи с эскроу
- Доставку по всей России
- Поддержку самозанятых (НПД 4%)`,
    seoTitle: "О платформе «Уездный кондитер» — маркетплейс домашних тортов",
    seoDescription: "Уездный кондитер — платформа для заказа тортов напрямую у домашних кондитеров. Безопасные платежи, доставка по России.",
    isPublished: true,
    updatedAt: "2026-06-15",
    updatedBy: "admin@demo.ru",
  },
  {
    id: "cms_p2",
    slug: "faq",
    title: "Часто задаваемые вопросы",
    content: `## Как сделать заказ?

Выберите торт в каталоге или соберите свой через конструктор. Свяжитесь с кондитером через чат для уточнения деталей. Оплатите заказ — средства попадут на эскроу-счёт. После получения заказа и подтверждения средства перечислятся кондитеру.

## Что такое эскроу-счёт?

Эскроу — это промежуточный счёт, на котором средства холдируются 24 часа после доставки. Если что-то не так — возвращаем деньги.

## Сколько стоит доставка?

По Москве — от 300 рублей, бесплатно при заказе от 3000 рублей. По России — СДЭК или Boxberry.

## Как стать кондитером?

Зарегистрируйтесь как кондитер, пройдите верификацию. Заполните профиль, добавьте работы в портфолио.`,
    seoTitle: "FAQ — вопросы и ответы | Кондитера",
    seoDescription: "Ответы на частые вопросы: как заказать торт, эскроу, доставка, как стать кондитером.",
    isPublished: true,
    updatedAt: "2026-06-20",
    updatedBy: "admin@demo.ru",
  },
  {
    id: "cms_p3",
    slug: "terms",
    title: "Условия использования",
    content: `# Условия использования платформы «Уездный кондитер»

## 1. Общие положения
Платформа предоставляет услуги по подбору кондитерских изделий и оформлению заказов.

## 2. Регистрация
Пользователь обязуется предоставлять достоверную информацию при регистрации.

## 3. Заказы и оплата
Все платежи проходят через платёжный шлюз YooKassa. Средства холдируются на эскроу-счёте 24 часа.

## 4. Возвраты
Возврат средств возможен в течение 24 часов после получения заказа при обоснованной претензии.

## 5. Ответственность
Платформа не несёт ответственности за качество изделий, но обеспечивает систему эскроу и разрешения споров.`,
    seoTitle: "Условия использования | Кондитера",
    seoDescription: "Условия использования платформы «Уездный кондитер».",
    isPublished: true,
    updatedAt: "2026-06-10",
    updatedBy: "admin@demo.ru",
  },
  {
    id: "cms_p4",
    slug: "privacy",
    title: "Политика конфиденциальности",
    content: `# Политика конфиденциальности

Мы собираем минимально необходимые данные для работы платформы: email, телефон, имя, адрес доставки.

Персональные данные не передаются третьим лицам, кроме случаев, предусмотренных законом.

Мы используем cookies для улучшения работы сайта.`,
    seoTitle: "Политика конфиденциальности | Кондитера",
    seoDescription: "Политика обработки персональных данных.",
    isPublished: true,
    updatedAt: "2026-06-10",
    updatedBy: "admin@demo.ru",
  },
];

// ===== БЛОКИ CMS (секции главной страницы) =====
export const MOCK_CMS_BLOCKS = [
  {
    id: "cms_b1",
    pageId: null,
    section: "hero",
    title: "Торты и десерты от уездных кондитеров",
    subtitle: "Заказывайте домашние торты напрямую у проверенных кондитеров со всей России. Конструктор тортов, безопасные платежи с эскроу, доставка в ваш город.",
    content: null,
    image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800",
    link: "catalog",
    linkText: "Смотреть каталог",
    sortOrder: 0,
    isActive: true,
    metadata: JSON.stringify({ badge: "Маркетплейс от частных кондитеров России" }),
    updatedAt: "2026-06-28",
    updatedBy: "admin@demo.ru",
  },
  {
    id: "cms_b2",
    pageId: null,
    section: "stats",
    title: null,
    subtitle: null,
    content: null,
    image: null,
    link: null,
    linkText: null,
    sortOrder: 1,
    isActive: true,
    metadata: JSON.stringify({
      items: [
        { value: "2 400+", label: "Кондитеров", icon: "Users" },
        { value: "18 000+", label: "Товаров", icon: "Cake" },
        { value: "120 000+", label: "Заказов", icon: "Truck" },
        { value: "4.9 / 5", label: "Рейтинг", icon: "Star" },
      ],
    }),
    updatedAt: "2026-06-28",
    updatedBy: "admin@demo.ru",
  },
  {
    id: "cms_b3",
    pageId: null,
    section: "cta_confectioner",
    title: "Продавайте свои торты по всей России",
    subtitle: "Присоединяйтесь к 2 400+ кондитерам на платформе. Витрина, CRM, финансовая аналитика, помощь с налогами (НПД). Тарифы от 5% комиссии.",
    content: null,
    image: null,
    link: "auth",
    linkText: "Стать кондитером",
    sortOrder: 10,
    isActive: true,
    metadata: JSON.stringify({
      stats: [
        { val: "5%", label: "Старт комиссии" },
        { val: "24ч", label: "Эскроу-холд" },
        { val: "4%", label: "НПД с физлиц" },
      ],
    }),
    updatedAt: "2026-06-28",
    updatedBy: "admin@demo.ru",
  },
];

// ===== БАННЕРЫ =====
export const MOCK_BANNERS = [
  {
    id: "bn1",
    title: "Свадебный сезон 2026",
    subtitle: "Торты от 15 000 ₽ с бесплатной доставкой и сахарными цветами в подарок",
    image: "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=1200",
    link: "catalog",
    buttonText: "Выбрать свадебный торт",
    position: "hero",
    isActive: true,
    sortOrder: 0,
    startDate: "2026-06-01",
    endDate: "2026-09-30",
    createdAt: "2026-06-01",
    updatedAt: "2026-06-15",
  },
  {
    id: "bn2",
    title: "8 июля — День семьи",
    subtitle: "Скидка 20% на все медовики в этот день",
    image: "https://images.unsplash.com/photo-1606890737304-57a1ca8a5b62?w=1200",
    link: "promotions",
    buttonText: "Все акции",
    position: "top",
    isActive: true,
    sortOrder: 1,
    startDate: "2026-07-01",
    endDate: "2026-07-08",
    createdAt: "2026-06-25",
    updatedAt: "2026-06-25",
  },
  {
    id: "bn3",
    title: "Новый год 2027",
    subtitle: "Корпоративные торты для вашей компании. Сcharted заказ от 50 человек.",
    image: "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=1200",
    link: "corporate-events",
    buttonText: "Корпоративный заказ",
    position: "category",
    isActive: false,
    sortOrder: 2,
    startDate: "2026-11-01",
    endDate: "2026-12-31",
    createdAt: "2026-06-20",
    updatedAt: "2026-06-20",
  },
];

// ===== НАСТРОЙКИ САЙТА =====
export const MOCK_SITE_SETTINGS = [
  // General
  { id: "ss1", key: "site_name", value: "Кондитера", category: "general", description: "Название сайта" },
  { id: "ss2", key: "site_url", value: "https://conditera.ru", category: "general", description: "URL сайта" },
  { id: "ss3", key: "support_email", value: "hello@conditera.ru", category: "general", description: "Email поддержки" },
  { id: "ss4", key: "support_phone", value: "8 (800) 123-45-67", category: "general", description: "Телефон поддержки" },
  { id: "ss5", key: "address", value: "Москва, ул. Тверская, 1", category: "general", description: "Адрес офиса" },

  // Commission
  { id: "ss6", key: "tariff_start_commission", value: "15", category: "commission", description: "Комиссия тарифа Старт (%)" },
  { id: "ss7", key: "tariff_profi_commission", value: "10", category: "commission", description: "Комиссия тарифа Профи (%)" },
  { id: "ss8", key: "tariff_premium_commission", value: "5", category: "commission", description: "Комиссия тарифа Премиум (%)" },
  { id: "ss9", key: "yookassa_commission", value: "2.5", category: "commission", description: "Комиссия YooKassa (%)" },
  { id: "ss10", key: "escrow_hold_hours", value: "24", category: "commission", description: "Время холдирования эскроу (часов)" },

  // Delivery
  { id: "ss11", key: "delivery_base_cost", value: "300", category: "delivery", description: "Базовая стоимость доставки (₽)" },
  { id: "ss12", key: "delivery_free_from", value: "3000", category: "delivery", description: "Бесплатная доставка от (₽)" },
  { id: "ss13", key: "delivery_express_cost", value: "600", category: "delivery", description: "Экспресс-доставка (₽)" },

  // Loyalty
  { id: "ss14", key: "loyalty_bronze_threshold", value: "0", category: "loyalty", description: "Порог Bronze (₽)" },
  { id: "ss15", key: "loyalty_silver_threshold", value: "5000", category: "loyalty", description: "Порог Silver (₽)" },
  { id: "ss16", key: "loyalty_gold_threshold", value: "15000", category: "loyalty", description: "Порог Gold (₽)" },
  { id: "ss17", key: "loyalty_platinum_threshold", value: "50000", category: "loyalty", description: "Порог Platinum (₽)" },

  // NPD
  { id: "ss18", key: "npd_rate_individual", value: "4", category: "tax", description: "НПД с физлиц (%)" },
  { id: "ss19", key: "npd_rate_legal", value: "6", category: "tax", description: "НПД с юрлиц (%)" },
  { id: "ss20", key: "npd_deduction", value: "10000", category: "tax", description: "Налоговый вычет НПД (₽)" },
  { id: "ss21", key: "npd_max_income", value: "2400000", category: "tax", description: "Лимит дохода НПД (₽/год)" },

  // SEO
  { id: "ss22", key: "seo_title", value: "Уездный кондитер — маркетплейс домашних тортов по России", category: "seo", description: "SEO Title главной" },
  { id: "ss23", key: "seo_description", value: "Заказывайте домашние торты напрямую у проверенных кондитеров. Конструктор тортов, безопасные платежи, доставка.", category: "seo", description: "SEO Description главной" },
  { id: "ss24", key: "seo_keywords", value: "торты на заказ, домашние торты, кондитеры, маркетплейс тортов, конструктор торта", category: "seo", description: "SEO Keywords" },

  // Social
  { id: "ss25", key: "telegram_channel", value: "@conditera", category: "social", description: "Telegram-канал" },
  { id: "ss26", key: "vk_group", value: "https://vk.com/conditera", category: "social", description: "Группа ВКонтакте" },
  { id: "ss27", key: "instagram", value: "https://instagram.com/conditera", category: "social", description: "Instagram" },
  { id: "ss28", key: "youtube", value: "https://youtube.com/@conditera", category: "social", description: "YouTube" },
  { id: "ss29", key: "whatsapp", value: "https://wa.me/79000000000", category: "social", description: "WhatsApp" },
  { id: "ss30", key: "dzen", value: "https://dzen.ru/conditera", category: "social", description: "Яндекс.Дзен" },
  { id: "ss31", key: "max", value: "https://max.ru/conditera", category: "social", description: "Макс" },
  { id: "ss32", key: "rutube", value: "https://rutube.ru/u/conditera", category: "social", description: "Rutube" },
];

// ===== НАВИГАЦИЯ =====
export const MOCK_NAV_MENU = [
  { id: "nm1", label: "Каталог", link: "catalog", icon: "Search", sortOrder: 0, isActive: true, isDropdown: false, parentId: null },
  { id: "nm2", label: "Кондитеры", link: "confectioners", icon: "Users", sortOrder: 1, isActive: true, isDropdown: false, parentId: null },
  { id: "nm3", label: "Акции", link: "promotions", icon: "Flame", sortOrder: 2, isActive: true, isDropdown: false, parentId: null },
  { id: "nm4", label: "Декор", link: "decor-shop", icon: "Gift", sortOrder: 3, isActive: true, isDropdown: false, parentId: null },
  { id: "nm5", label: "Услуги", link: "services-shop", icon: "Sparkles", sortOrder: 4, isActive: true, isDropdown: false, parentId: null },
  { id: "nm6", label: "Рецепты", link: "recipes", icon: "BookOpen", sortOrder: 5, isActive: true, isDropdown: false, parentId: null },
  { id: "nm7", label: "Корпоративам", link: "corporate-events", icon: "Building2", sortOrder: 6, isActive: true, isDropdown: false, parentId: null },
];

// ===== ОТЗЫВЫ НА МОДЕРАЦИЮ =====
export const MOCK_REVIEWS_MODERATION = [
  {
    id: "rm1",
    productId: "p1",
    productName: "Торт «Уездный классический»",
    userId: "u_new1",
    userName: "Новый Покупатель",
    userAvatar: "https://i.pravatar.cc/150?img=5",
    rating: 5,
    text: "Отличный торт! Очень вкусный, всем понравился. Спасибо Марии!",
    images: [],
    status: "pending", // pending | approved | rejected
    createdAt: "2026-06-29",
  },
  {
    id: "rm2",
    productId: "p4",
    productName: "Авторский торт «Лебедь»",
    userId: "u_new2",
    userName: "Светлана Р.",
    userAvatar: "https://i.pravatar.cc/150?img=9",
    rating: 1,
    text: "Ужасный сервис! Торт приехал через 3 часа после назначенного времени. Хотя сам торт был вкусный, но такое опоздание неприемлемо!",
    images: [],
    status: "pending",
    createdAt: "2026-06-28",
  },
  {
    id: "rm3",
    productId: "p5",
    productName: "Набор капкейков «Праздничный»",
    userId: "u_new3",
    userName: "Аноним",
    userAvatar: null,
    rating: 5,
    text: "Капкейки супер! Заказываю уже третий раз. Особенно liked красный бархат.",
    images: [],
    status: "flagged", // flagged — кто-то пожаловался
    createdAt: "2026-06-27",
    flagReason: "Спам — похоже на накрутку отзыва",
  },
  {
    id: "rm4",
    productId: "p2",
    productName: "Торт «Купеческий медовик»",
    userId: "u_new4",
    userName: "Дмитрий К.",
    userAvatar: "https://i.pravatar.cc/150?img=15",
    rating: 3,
    text: "Торт нормальный, но сладковат. Может стоит меньше сахара в крем?",
    images: [],
    status: "pending",
    createdAt: "2026-06-26",
  },
];

// Категории настроек для отображения
export const SETTING_CATEGORIES = [
  { id: "general", label: "Общие", icon: "⚙️" },
  { id: "commission", label: "Комиссии и тарифы", icon: "💰" },
  { id: "delivery", label: "Доставка", icon: "🚚" },
  { id: "loyalty", label: "Лояльность", icon: "⭐" },
  { id: "tax", label: "Налоги (НПД)", icon: "📋" },
  { id: "seo", label: "SEO", icon: "🔍" },
  { id: "social", label: "Соцсети", icon: "📱" },
];
