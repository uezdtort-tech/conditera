"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  User,
  Role,
  NavState,
  CartItem,
  Product,
  ChatRoom,
  ChatMessage,
  CakeBuilderState,
  Courier,
  Location,
  Promotion,
  Recipe,
  InventoryItem,
  StockMovement,
  GanttTask,
  Reminder,
  CorporateEvent,
  BlacklistEntry,
  SemaphoreEntry,
  UserLegalInfo,
  DecorShop,
  DecorProduct,
  ProductBundle,
  ServiceShop,
  ServiceProduct,
  UserHoliday,
  GiftCertificate,
  Referral,
  VideoReview,
  CourierTracking,
  OrderNegotiation,
  NegotiationItem,
  NegotiationStatus,
  ChannelStory,
  ChannelFollower,
  ChannelComment,
  TastingLocation,
  QuickReply,
  ConfectionerWork,
  FraudReport,
  FraudRule,
} from "./types";
import {
  MOCK_USERS,
  MOCK_CONFECTIONERS,
  MOCK_PRODUCTS,
  MOCK_ORDERS,
  MOCK_CHAT_ROOMS,
  MOCK_CHAT_MESSAGES,
  MOCK_CHANNEL_POSTS,
  MOCK_CHANNEL_STORIES,
  MOCK_CHANNEL_FOLLOWERS,
  MOCK_CONSTRUCTOR_INQUIRIES,
  MOCK_TEAM_TASKS,
  MOCK_COURIERS,
} from "./mock-data";
import {
  MOCK_PROMOTIONS,
  MOCK_RECIPES,
  MOCK_INVENTORY,
  MOCK_STOCK_MOVEMENTS,
  MOCK_GANTT_TASKS,
  MOCK_REMINDERS,
} from "./mock-data-extra";
import {
  MOCK_CORPORATE_EVENTS,
  MOCK_BLACKLIST,
  MOCK_SEMAPHORES,
  MOCK_LEGAL_USERS,
} from "./mock-data-corporate";
import {
  MOCK_DECOR_SHOPS,
  MOCK_DECOR_PRODUCTS,
  MOCK_BUNDLES,
} from "./mock-data-decor";
import {
  MOCK_SERVICE_SHOPS,
  MOCK_SERVICE_PRODUCTS,
} from "./mock-data-services";
import {
  MOCK_USER_HOLIDAYS,
  MOCK_GIFT_CERTIFICATES,
  MOCK_REFERRAL,
  MOCK_VIDEO_REVIEWS,
  MOCK_COURIER_TRACKING,
} from "./mock-data-features";
import {
  MOCK_CMS_PAGES,
  MOCK_CMS_BLOCKS,
  MOCK_BANNERS,
  MOCK_SITE_SETTINGS,
  MOCK_NAV_MENU,
  MOCK_REVIEWS_MODERATION,
} from "./mock-data-cms";
import { MOCK_NEGOTIATIONS } from "./mock-data-negotiation";
import { MOCK_VENUES, MOCK_VENUE_SERVICES, MOCK_VENUE_VENDORS } from "./mock-data-venues";
import { FILLINGS_SEED } from "./fillings-data";

interface AppState {
  // Auth
  user: User | null;
  activeRole: Role | null;
  isAuthenticated: boolean;
  authModalOpen: boolean;

  // Navigation
  nav: NavState;

  // Cart
  cart: CartItem[];
  cartOpen: boolean;
  promoCode: string | null;
  promoDiscount: number;

  // Favorites
  favorites: string[]; // product ids

  // ===== Точки дегустации (где попробовать) =====
  tastingLocations: TastingLocation[];
  addTastingLocation: (loc: Omit<TastingLocation, "id" | "createdAt" | "verified">) => string;
  updateTastingLocation: (id: string, patch: Partial<TastingLocation>) => void;
  deleteTastingLocation: (id: string) => void;
  getTastingLocations: (confectionerId: string) => TastingLocation[];
  getAllTastingLocations: () => TastingLocation[];
  getTastingLocationsByCity: (city: string) => TastingLocation[];

  // UI
  chatOpen: boolean;
  mobileMenuOpen: boolean;
  theme: "light" | "dark";

  // Chat
  chatRooms: ChatRoom[];
  chatMessages: ChatMessage[];
  activeChatRoom: string | null;

  // Cake Builder
  cakeBuilder: CakeBuilderState;
  cakeBuilderOpen: boolean;

  // User location (для фильтра «рядом»)
  userLocation: Location | null;
  userCity: string | null;

  // Data (для дашбордов)
  confectioners: typeof MOCK_CONFECTIONERS;
  /**
   * Заменяет весь список кондитеров. Используется useConfectioners() при
   * получении живых данных из Supabase, чтобы бегущая строка / страница
   * кондитеров / профили автоматически обновлялись без правок компонентов.
   */
  setConfectioners: (confectioners: typeof MOCK_CONFECTIONERS) => void;
  /**
   * Live-гидрация витрины: замещает mock-товары товарами из БД
   * (вызывается LiveProductsHydrator'ом; пустой список НЕ затирает mock).
   */
  setLiveProducts: (products: Product[]) => void;
  couriers: Courier[];
  products: typeof MOCK_PRODUCTS;
  // Product CRUD
  addProduct: (product: Omit<Product, "id" | "rating" | "reviewsCount" | "createdAt">) => void;
  updateProduct: (id: string, updates: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  toggleProductVisibility: (id: string, reason?: string) => void;
  // Promotion CRUD
  addPromotion: (promotion: Omit<Promotion, "id" | "createdAt" | "views" | "clicks" | "conversions" | "usedCount">) => void;
  // Recipe CRUD
  addRecipe: (recipe: Omit<Recipe, "id" | "createdAt" | "views" | "likes" | "comments">) => void;
  orders: typeof MOCK_ORDERS;
  channelPosts: typeof MOCK_CHANNEL_POSTS;
  channelStories: ChannelStory[];
  channelFollowers: ChannelFollower[];
  inquiries: typeof MOCK_CONSTRUCTOR_INQUIRIES;
  teamTasks: typeof MOCK_TEAM_TASKS;
  // Новые данные
  promotions: Promotion[];
  venues: typeof MOCK_VENUES;
  venueServices: typeof MOCK_VENUE_SERVICES;
  venueVendors: typeof MOCK_VENUE_VENDORS;
  fillings: import("./fillings-data").FillingSeed[];
  recipes: Recipe[];
  inventory: InventoryItem[];
  stockMovements: StockMovement[];
  ganttTasks: GanttTask[];
  reminders: Reminder[];
  // Promo popup (региональная реклама)
  promoPopupShown: boolean;
  promoPopupDismissed: string[]; // id просмотренных акций
  // Корпоративные праздники + чёрный список + семафор
  corporateEvents: CorporateEvent[];
  blacklist: BlacklistEntry[];
  semaphores: SemaphoreEntry[];
  // Декор и упаковка
  decorShops: DecorShop[];
  decorProducts: DecorProduct[];
  bundles: ProductBundle[];
  // Услуги (фейерверки, шары, аниматоры)
  serviceShops: ServiceShop[];
  serviceProducts: ServiceProduct[];
  setLiveServiceProducts: (services: ServiceProduct[]) => void;
  // Новые фичи
  userHolidays: UserHoliday[];
  giftCertificates: GiftCertificate[];
  referral: Referral | null;
  videoReviews: VideoReview[];
  courierTracking: CourierTracking | null;
  // CMS
  cmsPages: any[];
  cmsBlocks: any[];
  banners: any[];
  siteSettings: any[];
  navMenu: any[];
  reviewsModeration: any[];
  // Согласование заказов
  negotiations: OrderNegotiation[];
  // Работы кондитеров (портфолио)
  confectionerWorks: ConfectionerWork[];
  addConfectionerWork: (work: Omit<ConfectionerWork, "id" | "createdAt" | "views" | "likes">) => void;
  updateConfectionerWork: (id: string, updates: Partial<ConfectionerWork>) => void;
  deleteConfectionerWork: (id: string) => void;
  toggleWorkFeatured: (id: string) => void;
  likeConfectionerWork: (id: string) => void;
  // Fraud reports
  fraudReports: FraudReport[];
  riskScores: Record<string, number>;
  fraudRules: FraudRule[];
  resolveFraudReport: (id: string, resolution: string) => void;
  assignFraudReport: (id: string, assignedTo: string) => void;
  toggleFraudRule: (id: string) => void;
  calculateRiskScore: (userId: string) => number;
  createFraudReport: (report: Omit<FraudReport, "id" | "reportedAt" | "riskScore" | "status">) => void;

  // Actions
  login: (email: string, password: string) => { success: boolean; error?: string };
  loginAs: (role: Role) => void;
  /** Синхронизация сессии Supabase → Zustand (вызывает SupabaseAuthSync) */
  setSupabaseUser: (user: User | null) => void;
  logout: () => void;
  setActiveRole: (role: Role) => void;
  setAuthModalOpen: (open: boolean) => void;

  navigate: (view: NavState["view"], params?: Record<string, string>) => void;

  addToCart: (product: Product, customization?: CartItem["customization"], quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateCartQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setCartOpen: (open: boolean) => void;
  applyPromo: (code: string) => { success: boolean; discount: number; error?: string };
  clearPromo: () => void;

  toggleFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;

  setChatOpen: (open: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
  setActiveChatRoom: (roomId: string | null) => void;
  sendMessage: (roomId: string, text: string) => void;
  sendQuickReply: (roomId: string, reply: QuickReply) => void;

  setCakeBuilderOpen: (open: boolean) => void;
  updateCakeBuilder: (state: Partial<CakeBuilderState>) => void;
  resetCakeBuilder: () => void;

  // Location
  setUserLocation: (location: Location | null) => void;
  setUserCity: (city: string | null) => void;
  detectUserLocation: () => Promise<void>;

  // Dashboards
  updateOrderStatus: (orderId: string, status: string) => void;
  updateTaskStatus: (taskId: string, status: string) => void;
  respondToInquiry: (inquiryId: string, price: number) => void;

  // Promotions
  createPromotion: (promo: Omit<Promotion, "id" | "createdAt" | "views" | "clicks" | "conversions" | "usedCount">) => void;
  updatePromotion: (id: string, updates: Partial<Promotion>) => void;
  deletePromotion: (id: string) => void;
  promotePromotion: (id: string, budget: number, regions: string[]) => void;

  // Recipes
  createRecipe: (recipe: Omit<Recipe, "id" | "createdAt" | "views" | "likes" | "comments">) => void;
  updateRecipe: (id: string, updates: Partial<Recipe>) => void;
  deleteRecipe: (id: string) => void;

  // Inventory
  addInventoryItem: (item: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">) => void;
  updateInventoryItem: (id: string, updates: Partial<InventoryItem>) => void;
  deleteInventoryItem: (id: string) => void;
  addStockMovement: (movement: Omit<StockMovement, "id" | "date">) => void;

  // Gantt
  updateGanttTask: (id: string, updates: Partial<GanttTask>) => void;
  addGanttTask: (task: Omit<GanttTask, "id">) => void;

  // Reminders
  markReminderRead: (id: string) => void;
  markReminderDone: (id: string) => void;
  addReminder: (reminder: Omit<Reminder, "id" | "createdAt" | "isRead" | "isDone">) => void;

  // Promo popup
  showPromoPopup: () => void;
  dismissPromoPopup: (promotionId: string) => void;

  // Corporate events
  createCorporateEvent: (event: Omit<CorporateEvent, "id" | "createdAt" | "responsesCount">) => void;
  updateCorporateEvent: (id: string, updates: Partial<CorporateEvent>) => void;
  respondToCorporateEvent: (eventId: string, confectionerId: string) => void;

  // Blacklist
  addToBlacklist: (entry: Omit<BlacklistEntry, "id" | "blockedAt">) => void;
  removeFromBlacklist: (id: string) => void;
  appealBlacklist: (id: string, text: string) => void;
  checkBlacklist: (value: string, scope?: string) => BlacklistEntry | null;

  // Semaphore
  checkSemaphore: (type: "email" | "phone", value: string) => { available: boolean; existingUser?: string };
  registerSemaphore: (type: "email" | "phone", value: string, userId: string) => void;

  // User legal info
  updateUserLegalInfo: (userId: string, legalInfo: UserLegalInfo) => void;
  updateUserAccountType: (userId: string, accountType: "individual" | "legal") => void;

  // Register new user (с семафором)
  registerUser: (data: {
    email: string;
    password: string;
    name: string;
    phone: string;
    role: Role;
    accountType: "individual" | "legal";
    legalInfo?: UserLegalInfo;
  }) => { success: boolean; error?: string };

  // Holidays
  addHoliday: (holiday: Omit<UserHoliday, "id" | "userId">) => void;
  deleteHoliday: (id: string) => void;
  // Gift certificates
  purchaseGiftCertificate: (cert: Omit<GiftCertificate, "id" | "code" | "purchasedAt" | "expiresAt" | "status" | "remainingAmount">) => void;
  // Referral
  copyReferralLink: () => string;
  // Video reviews
  addVideoReview: (review: Omit<VideoReview, "id" | "createdAt" | "views" | "likes">) => void;

  // CMS
  updateCmsPage: (id: string, updates: any) => void;
  updateCmsBlock: (id: string, updates: any) => void;
  addCmsBlock: (block: any) => void;
  deleteCmsBlock: (id: string) => void;
  updateBanner: (id: string, updates: any) => void;
  addBanner: (banner: any) => void;
  deleteBanner: (id: string) => void;
  updateSiteSetting: (key: string, value: string) => void;
  updateNavMenu: (items: any[]) => void;
  approveReview: (id: string) => void;
  rejectReview: (id: string, reason: string) => void;

  // Согласование заказов
  quoteNegotiation: (id: string, items: NegotiationItem[], total: number, comment: string, deliveryCost: number, prepTime: string) => void;
  approveNegotiation: (id: string, comment?: string) => void;
  rejectNegotiation: (id: string, comment: string) => void;
  reviseNegotiation: (id: string, items: NegotiationItem[], total: number, comment: string, deliveryCost: number, prepTime: string) => void;
  createNegotiationFromInquiry: (inquiryId: string, confectionerId: string) => void;
  // Кондитер: смена тарифа
  updateConfectionerTariff: (confectionerId: string, tariff: "START" | "PROFI" | "PREMIUM") => void;
  // Кондитер: отзыв предложения
  withdrawNegotiation: (id: string) => void;
  // Канал: лайки, комментарии, сторис, подписки
  togglePostLike: (postId: string) => void;
  addPostComment: (postId: string, text: string) => void;
  toggleCommentLike: (commentId: string) => void;
  viewStory: (storyId: string) => void;
  toggleFollow: (confectionerId: string) => void;
  isFollowing: (confectionerId: string) => boolean;
  // Venue owner
  getVenueByOwner: (ownerId: string) => any;
  priceLists: any[];
  addVenueService: (service: any) => void;
  updateVenueService: (id: string, updates: any) => void;
  deleteVenueService: (id: string) => void;
  toggleVenueServiceFeatured: (id: string) => void;
  addPriceList: (priceList: any) => void;
  addPriceListItem: (priceListId: string, item: any) => void;
  deletePriceListItem: (priceListId: string, itemId: string) => void;
  convertPriceItemToService: (priceListId: string, itemId: string) => void;
}

const PROMO_CODES: Record<string, number> = {
  WELCOME10: 0.1,
  SWEET15: 0.15,
  UYEZD20: 0.2,
  BIRTHDAY: 0.25,
};

// === Клиентский mini-FAQ для авточата в preview-mode ===
// (полная версия — в src/lib/chat-faq.ts, но она для server-side)
const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { label: "Как сделать заказ?", action: "faq:how_to_order" },
  { label: "Способы оплаты", action: "faq:payment" },
  { label: "Сроки доставки", action: "faq:delivery_time" },
  { label: "Программа лояльности", action: "faq:bonuses" },
  { label: "Соединить с оператором", action: "human:operator" },
];

const MINI_FAQ: { keywords: string[]; answer: string; quickReplies?: QuickReply[] }[] = [
  {
    keywords: ["когда", "доставка", "привезут", "срок"],
    answer:
      "📅 Сроки доставки:\n  • По Москве — день в день или на следующий день\n  • По России — 2-7 дней через СДЭК/Boxberry\n  • Самовывоз — сразу после готовности",
    quickReplies: [
      { label: "Как отследить?", action: "faq:track_order" },
      { label: "Самовывоз", action: "faq:self_pickup" },
    ],
  },
  {
    keywords: ["оплат", "карт", "сбп", "налич", "рассрочк"],
    answer:
      "💳 Способы оплаты:\n  • Карта (Visa, Mastercard, Мир)\n  • СБП по QR\n  • Наличные при получении\n  • Рассрочка: Сплит, Тинькофф, Сбер\n  • Подарочный сертификат\n\n🔒 Все платежи защищены по 3-D Secure.",
    quickReplies: [
      { label: "Что такое эскроу?", action: "faq:escrow" },
      { label: "Рассрочка", action: "faq:installment" },
    ],
  },
  {
    keywords: ["эскроу", "безопасн", "гаранти"],
    answer:
      "🛡️ Эскроу — промежуточный счёт, где ваши деньги 24 часа после получения заказа.\n\n  1. Оплата → деньги на эскроу\n  2. Получение заказа и проверка\n  3. Через 24ч → деньги кондитеру\n  4. Если проблема → спор, деньги остаются на эскроу",
    quickReplies: [
      { label: "Открыть спор", action: "dispute:open" },
    ],
  },
  {
    keywords: ["бонус", "балл", "лояльност", "кэшбек"],
    answer:
      "🎁 Программа лояльности:\n  • 1 балл за каждые 100₽\n  • 1 балл = 1₽\n\nУровни:\n  🥉 Бронзовый — ×1\n  🥈 Серебряный (5000₽) — ×1.2, скидка 3%\n  🥇 Золотой (15000₽) — ×1.5, скидка 5%\n  💎 Платиновый (50000₽) — ×2, скидка 10%",
    quickReplies: [
      { label: "Мои бонусы", action: "loyalty:my" },
    ],
  },
  {
    keywords: ["отмен", "вернуть", "отказ"],
    answer:
      "❌ Отмена заказа:\n  • PENDING/CONFIRMED — полная отмена\n  • IN_PROGRESS — с удержанием расходов\n  • После доставки — спор в течение 24ч\n\nВозврат: 3 рабочих дня на ту же карту.",
    quickReplies: [
      { label: "Отменить заказ", action: "order:cancel" },
      { label: "Соединить с оператором", action: "human:operator" },
    ],
  },
  {
    keywords: ["аллерг", "состав", "глютен", "орех", "пп", "веган"],
    answer:
      "🥗 Аллергены и состав:\n  • Полный состав в карточке товара\n  • Возможные: глютен, молоко, яйца, орехи, соя\n  • ПП-варианты: на стевии/эритрите\n  • Безглютеновые: миндальная/рисовая мука",
    quickReplies: [
      { label: "ПП-каталог", action: "catalog:pp" },
      { label: "Безглютеновые", action: "catalog:gluten_free" },
    ],
  },
  {
    keywords: ["конструктор", "собрать торт", "индивид", "на заказ"],
    answer:
      "🎂 Конструктор тортов:\n  • Выбор формы, размера, начинки, покрытия, декора\n  • Подпись на торте\n  • Подбор кондитеров\n  • Запрос скидки у нескольких",
    quickReplies: [
      { label: "Открыть конструктор", action: "cake_builder:open" },
    ],
  },
  {
    keywords: ["жалоб", "плохо", "невкус", "испорч", "битый"],
    answer:
      "😞 Сожалею. Что делать:\n  1. Сделайте фото проблемы\n  2. Откройте спор в течение 24ч\n  3. Опишите и приложите фото\n  4. Модератор ответит за 24ч\n\nВозможно: возврат, частичная компенсация или замена.",
    quickReplies: [
      { label: "Открыть спор", action: "dispute:open" },
      { label: "Оператор", action: "human:operator" },
    ],
  },
];

function simpleFaqMatch(message: string): { answer: string; quickReplies?: QuickReply[] } | null {
  const lower = message.toLowerCase();
  let best: { answer: string; quickReplies?: QuickReply[] } | null = null;
  let bestScore = 0;
  for (const topic of MINI_FAQ) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (lower.includes(kw)) score += kw.length > 5 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { answer: topic.answer, quickReplies: topic.quickReplies };
    }
  }
  return bestScore > 0 ? best : null;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ===== Initial state =====
      user: null,
      activeRole: null,
      isAuthenticated: false,
      authModalOpen: false,

      nav: { view: "home" },

      cart: [],
      cartOpen: false,
      promoCode: null,
      promoDiscount: 0,

      favorites: [],

      chatOpen: false,
      mobileMenuOpen: false,
      theme: "light",

      chatRooms: MOCK_CHAT_ROOMS,
      chatMessages: MOCK_CHAT_MESSAGES,
      activeChatRoom: null,

      cakeBuilder: { step: 0, decorations: [], dietary: [], productType: undefined, servings: undefined, quantity: undefined },
      cakeBuilderOpen: false,

      // По умолчанию — Москва
      userLocation: {
        country: "Россия",
        region: "Москва",
        city: "Москва",
        district: "Тверской",
        lat: 55.7558,
        lng: 37.6173,
      },
      userCity: "Москва",

      confectioners: MOCK_CONFECTIONERS,
      couriers: MOCK_COURIERS,
      products: MOCK_PRODUCTS,

      setLiveProducts: (liveProducts) => {
        // Пустой ответ из БД — витрина остаётся на mock-данных (dev/фоллбэк)
        if (!liveProducts || liveProducts.length === 0) return;
        set({ products: liveProducts });
      },

      setLiveServiceProducts: (liveServices) => {
        // Пустой ответ из БД — витрина услуг остаётся на mock-данных (dual-mode)
        if (!liveServices || liveServices.length === 0) return;
        set({ serviceProducts: liveServices });
      },

      addProduct: (productData) => {
        const newProduct: Product = {
          ...productData,
          id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          rating: 0,
          reviewsCount: 0,
          createdAt: new Date().toISOString(),
        } as Product;
        set({ products: [newProduct, ...get().products] });
      },

      updateProduct: (id, updates) => {
        set({
          products: get().products.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        });
      },

      deleteProduct: (id) => {
        set({ products: get().products.filter((p) => p.id !== id) });
      },

      toggleProductVisibility: (id, reason) => {
        set({
          products: get().products.map((p) =>
            p.id === id
              ? {
                  ...p,
                  isHidden: !p.isHidden,
                  hiddenReason: !p.isHidden ? (reason || "Скрыт администратором") : undefined,
                  hiddenAt: !p.isHidden ? new Date().toISOString() : undefined,
                }
              : p
          ),
        });
      },

      addPromotion: (promoData) => {
        const newPromo: Promotion = {
          ...promoData,
          id: `promo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          views: 0,
          clicks: 0,
          conversions: 0,
          usedCount: 0,
        } as Promotion;
        set({ promotions: [newPromo, ...get().promotions] });
      },

      addRecipe: (recipeData) => {
        const newRecipe: Recipe = {
          ...recipeData,
          id: `recipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          views: 0,
          likes: 0,
          comments: 0,
        } as Recipe;
        set({ recipes: [newRecipe, ...get().recipes] });
      },

      orders: MOCK_ORDERS,
      channelPosts: MOCK_CHANNEL_POSTS,
  channelStories: MOCK_CHANNEL_STORIES,
  channelFollowers: MOCK_CHANNEL_FOLLOWERS,
      inquiries: MOCK_CONSTRUCTOR_INQUIRIES,
      teamTasks: MOCK_TEAM_TASKS,
      // Новые данные
      promotions: MOCK_PROMOTIONS,
      venues: MOCK_VENUES,
      venueServices: MOCK_VENUE_SERVICES,
      venueVendors: MOCK_VENUE_VENDORS,
      fillings: FILLINGS_SEED,
      recipes: MOCK_RECIPES,
      inventory: MOCK_INVENTORY,
      stockMovements: MOCK_STOCK_MOVEMENTS,
      ganttTasks: MOCK_GANTT_TASKS,
      reminders: MOCK_REMINDERS,
      promoPopupShown: false,
      promoPopupDismissed: [],
      // Корпоратив + чёрный список + семафор
      corporateEvents: MOCK_CORPORATE_EVENTS,
      blacklist: MOCK_BLACKLIST,
      semaphores: [...MOCK_SEMAPHORES, ...MOCK_LEGAL_USERS.flatMap((u) => [
        { id: `s_${u.id}_e`, type: "email" as const, value: u.email, userId: u.id, verified: true, registeredAt: u.createdAt, attempts: 1 },
        ...(u.phone ? [{ id: `s_${u.id}_p`, type: "phone" as const, value: u.phone, userId: u.id, verified: true, registeredAt: u.createdAt, attempts: 1 }] : []),
      ])],
      decorShops: MOCK_DECOR_SHOPS,
      decorProducts: MOCK_DECOR_PRODUCTS,
      bundles: MOCK_BUNDLES,
      serviceShops: MOCK_SERVICE_SHOPS,
      serviceProducts: MOCK_SERVICE_PRODUCTS,
      userHolidays: MOCK_USER_HOLIDAYS,
      giftCertificates: MOCK_GIFT_CERTIFICATES,
      referral: MOCK_REFERRAL,
      videoReviews: MOCK_VIDEO_REVIEWS,
      courierTracking: MOCK_COURIER_TRACKING,
      // CMS
      cmsPages: MOCK_CMS_PAGES,
      cmsBlocks: MOCK_CMS_BLOCKS,
      banners: MOCK_BANNERS,
      siteSettings: MOCK_SITE_SETTINGS,
      navMenu: MOCK_NAV_MENU,
      reviewsModeration: MOCK_REVIEWS_MODERATION,
      negotiations: MOCK_NEGOTIATIONS,
      confectionerWorks: [],
      fraudReports: [],
      riskScores: {},
      fraudRules: [],

      // ===== Actions =====
      login: (email, password) => {
        // Объединяем демо-пользователей + зарегистрированных юрлиц
        const legalUsersWithPasswords = MOCK_LEGAL_USERS.map((u) => ({ ...u, password: "demo123" }));
        const allUsers = [...MOCK_USERS, ...legalUsersWithPasswords];
        const user = allUsers.find((u) => u.email === email && u.password === password);
        if (user) {
          const { password: _, ...userWithoutPassword } = user;
          set({
            user: userWithoutPassword,
            activeRole: userWithoutPassword.roles[0],
            isAuthenticated: true,
            authModalOpen: false,
          });
          return { success: true };
        }
        return { success: false, error: "Неверный email или пароль" };
      },

      loginAs: (role) => {
        // Демо-вход под ролью (без пароля)
        const roleUserMap: Record<string, string> = {
          CUSTOMER: "customer@demo.ru",
          CONFECTIONER: "confectioner@demo.ru",
          SUPPLIER: "supplier@demo.ru",
          COURIER: "courier@demo.ru",
          ADMIN: "admin@demo.ru",
          SUPER_ADMIN: "admin@demo.ru",
        };
        const email = roleUserMap[role] || "customer@demo.ru";
        const user = MOCK_USERS.find((u) => u.email === email);
        if (user) {
          const { password: _, ...userWithoutPassword } = user;
          set({
            user: userWithoutPassword,
            activeRole: role,
            isAuthenticated: true,
            authModalOpen: false,
            nav: { view: getDashboardView(role) },
          });
        }
      },

      logout: () => {
        set({
          user: null,
          activeRole: null,
          isAuthenticated: false,
          nav: { view: "home" },
          cart: [],
          favorites: [],
        });
      },

      setSupabaseUser: (user) => {
        if (!user) {
          // SIGNED_OUT: очищаем пользователя, но НЕ сбрасываем nav/cart
          // (машину покупателя и текущий раздел сохраняем)
          set({ user: null, activeRole: null, isAuthenticated: false });
          return;
        }
        set({
          user,
          activeRole: user.roles[0] ?? null,
          isAuthenticated: true,
          authModalOpen: false,
        });
      },

      setActiveRole: (role) => set({ activeRole: role }),

      setConfectioners: (confectioners) => set({ confectioners }),

      setAuthModalOpen: (open) => set({ authModalOpen: open }),

      navigate: (view, params) => {
        set({ nav: { view, params }, mobileMenuOpen: false });
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      },

      addToCart: (product, customization, quantity = 1) => {
        const cart = get().cart;
        const existingIndex = cart.findIndex(
          (item) =>
            item.productId === product.id &&
            JSON.stringify(item.customization) === JSON.stringify(customization)
        );
        if (existingIndex >= 0) {
          const newCart = [...cart];
          newCart[existingIndex].quantity += quantity;
          set({ cart: newCart, cartOpen: true });
        } else {
          let price = product.price;
          if (customization) {
            const filling = product.fillings?.find((f) => f.name === customization.filling);
            const coating = product.coatings?.find((c) => c.name === customization.coating);
            const decoration = product.decorations?.find((d) => d.name === customization.decoration);
            if (filling) price += filling.priceModifier;
            if (coating) price += coating.priceModifier;
            if (decoration) price += decoration.priceModifier;
          }
          set({
            cart: [
              ...cart,
              {
                productId: product.id,
                title: product.title,
                image: product.images[0],
                price,
                quantity,
                confectionerId: product.confectionerId,
                customization,
              },
            ],
            cartOpen: true,
          });
        }
      },

      removeFromCart: (productId) => {
        set({ cart: get().cart.filter((item) => item.productId !== productId) });
      },

      updateCartQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeFromCart(productId);
          return;
        }
        set({
          cart: get().cart.map((item) =>
            item.productId === productId ? { ...item, quantity } : item
          ),
        });
      },

      clearCart: () => set({ cart: [], promoCode: null, promoDiscount: 0 }),
      setCartOpen: (open) => set({ cartOpen: open }),

      applyPromo: (code) => {
        const upperCode = code.toUpperCase();
        if (PROMO_CODES[upperCode]) {
          set({ promoCode: upperCode, promoDiscount: PROMO_CODES[upperCode] });
          return { success: true, discount: PROMO_CODES[upperCode] };
        }
        return { success: false, discount: 0, error: "Промокод не найден" };
      },

      clearPromo: () => set({ promoCode: null, promoDiscount: 0 }),

      toggleFavorite: (productId) => {
        const favorites = get().favorites;
        if (favorites.includes(productId)) {
          set({ favorites: favorites.filter((id) => id !== productId) });
        } else {
          set({ favorites: [...favorites, productId] });
        }
      },

      isFavorite: (productId) => get().favorites.includes(productId),

      // ===== ТОЧКИ ДЕГУСТАЦИИ (где попробовать продукцию) =====
      tastingLocations: [
        {
          id: "tl-1",
          confectionerId: "c0",
          type: "cafe" as const,
          typeLabel: "Кофейня",
          establishmentName: "Кофейня «Уют»",
          description: "Здесь всегда можно купить торты с сахарной печатью на заказ. Свежие десерты ежедневно. Также доступен заказ тортов на праздничные даты.",
          availableProducts: ["Торт с фото на день рождения", "Торт на крестины", "Набор пряников с печатью"],
          contactName: "Анна",
          contactPhone: "+7 916 555-12-34",
          address: "ул. Революционная, 15",
          city: "Волоколамск",
          region: "Московская область",
          lat: 56.9555,
          lng: 35.9567,
          metroStation: "Центр",
          workingHours: "Пн-Вс 9:00-21:00",
          averageCheck: 500,
          photo: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=600",
          status: "active" as const,
          verified: true,
          createdAt: "2026-06-15T10:00:00",
        },
        {
          id: "tl-2",
          confectionerId: "c0",
          type: "restaurant" as const,
          typeLabel: "Ресторан",
          establishmentName: "Ресторан «Волоколамск»",
          description: "В меню ресторана — фирменные торты от нашего кондитера. На банкеты и свадьбы можно заказать многоярусные торты с сахарной печатью.",
          availableProducts: ["Свадебный торт «Сахарная печать»", "Торт на заказ (индивидуальный)"],
          contactName: "Администратор",
          contactPhone: "+7 496 222-33-44",
          address: "пр. Ленина, 28",
          city: "Волоколамск",
          region: "Московская область",
          lat: 56.9570,
          lng: 35.9590,
          metroStation: "",
          workingHours: "Пн-Вс 12:00-23:00",
          averageCheck: 2500,
          photo: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600",
          status: "active" as const,
          verified: false,
          createdAt: "2026-06-20T14:00:00",
        },
      ],

      addTastingLocation: (loc) => {
        const id = `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newLoc: TastingLocation = {
          ...loc,
          id,
          verified: false,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ tastingLocations: [newLoc, ...s.tastingLocations] }));
        return id;
      },

      updateTastingLocation: (id, patch) =>
        set((s) => ({
          tastingLocations: s.tastingLocations.map((tl) =>
            tl.id === id ? { ...tl, ...patch, updatedAt: new Date().toISOString() } : tl
          ),
        })),

      deleteTastingLocation: (id) =>
        set((s) => ({ tastingLocations: s.tastingLocations.filter((tl) => tl.id !== id) })),

      getTastingLocations: (confectionerId) =>
        get().tastingLocations.filter((tl) => tl.confectionerId === confectionerId && tl.status === "active"),

      getAllTastingLocations: () =>
        get().tastingLocations.filter((tl) => tl.status === "active"),

      getTastingLocationsByCity: (city) =>
        get().tastingLocations.filter((tl) => tl.city === city && tl.status === "active"),

      setChatOpen: (open) => set({ chatOpen: open }),
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
      setActiveChatRoom: (roomId) => set({ activeChatRoom: roomId }),

      sendMessage: (roomId, text) => {
        const user = get().user;
        if (!user) return;
        // === Клиентская модерация: проверка стоп-слов ===
        // Полная проверка — на сервере (через /api/moderation). Здесь — быстрая защита от очевидного.
        const STOP_WORDS = ["наркотик", "экстремизм", "теракт", "бомба", "убить"];
        const lowerText = text.toLowerCase();
        const hasStopWord = STOP_WORDS.some((w) => lowerText.includes(w));
        if (hasStopWord) {
          // Не отправляем, показываем предупреждение
          console.warn("[chat] Message blocked by client-side moderation");
          return;
        }
        // Dedup guard — если такое же сообщение уже было добавлено за последние 2 секунды, не дублируем
        const recentSame = get().chatMessages.find(
          (m) => m.roomId === roomId && m.text === text && m.senderId === user.id &&
            Date.now() - new Date(m.createdAt).getTime() < 2000
        );
        if (recentSame) return;
        const msgId = `m${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${(get() as any)._msgSeq = ((get() as any)._msgSeq || 0) + 1}`;
        const newMsg: ChatMessage = {
          id: msgId,
          roomId,
          senderId: user.id,
          senderName: user.name,
          senderAvatar: user.avatar,
          text,
          createdAt: new Date().toISOString(),
          isOwn: true,
        };
        set({ chatMessages: [...get().chatMessages, newMsg] });

        // Авточат: только для support/order комнат (не для direct чатов с кондитерами)
        const room = get().chatRooms.find(r => r.id === roomId);
        if (!room || room.type === "support" || room.type === "order") {
          setTimeout(() => {
            let botReply: ChatMessage;
            const botId = `b${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            try {
              const faqMatch = simpleFaqMatch(text);
              if (faqMatch) {
                botReply = {
                  id: botId,
                  roomId,
                  senderId: "bot",
                  senderName: "Уездный помощник",
                  senderAvatar: "/logo.png",
                  text: faqMatch.answer,
                  createdAt: new Date().toISOString(),
                  isBot: true,
                  botKind: "faq",
                  quickReplies: faqMatch.quickReplies,
                };
              } else if (/^(оператор|поддержк|человек|operator|support)\b/i.test(text.trim())) {
                botReply = {
                  id: botId,
                  roomId,
                  senderId: "bot",
                  senderName: "Уездный помощник",
                  senderAvatar: "/logo.png",
                  text: "👩‍💼 Я передал ваш запрос оператору поддержки. Среднее время ответа — 5-10 минут в рабочее время (10:00-22:00 МСК).",
                  createdAt: new Date().toISOString(),
                  isBot: true,
                  botKind: "escalation",
                };
              } else {
                botReply = {
                  id: botId,
                  roomId,
                  senderId: "bot",
                  senderName: "Уездный помощник",
                  senderAvatar: "/logo.png",
                  text: "🤔 Я не уверен, что правильно понял вопрос. Переформулируйте, пожалуйста, или выберите тему ниже:",
                  createdAt: new Date().toISOString(),
                  isBot: true,
                  botKind: "faq",
                  quickReplies: DEFAULT_QUICK_REPLIES,
                };
              }
            } catch (e) {
              botReply = {
                id: botId,
                roomId,
                senderId: "bot",
                senderName: "Уездный помощник",
                senderAvatar: "/logo.png",
                text: "Спасибо за сообщение! Оператор ответит в ближайшее время.",
                createdAt: new Date().toISOString(),
                isBot: true,
              };
            }
            set({ chatMessages: [...get().chatMessages, botReply] });
          }, 800);
        }
      },

      // Отправка quick-reply: пользователь нажал кнопку под bot-сообщением
      sendQuickReply: (roomId, reply) => {
        const user = get().user;
        if (!user) return;
        // Добавляем сообщение пользователя с текстом кнопки
        const userMsg: ChatMessage = {
          id: `m${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          roomId,
          senderId: user.id,
          senderName: user.name,
          senderAvatar: user.avatar,
          text: reply.label,
          createdAt: new Date().toISOString(),
          isOwn: true,
        };
        set({ chatMessages: [...get().chatMessages, userMsg] });

        // Если это эскалация на оператора
        if (reply.action === "human:operator") {
          setTimeout(() => {
            const botReply: ChatMessage = {
              id: `b${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              roomId,
              senderId: "bot",
              senderName: "Уездный помощник",
              senderAvatar: "/logo.png",
              text: "👩‍💼 Соединяю с оператором поддержки. Среднее время ожидания — 5-10 минут.",
              createdAt: new Date().toISOString(),
              isBot: true,
              botKind: "escalation",
            };
            set({ chatMessages: [...get().chatMessages, botReply] });
          }, 500);
          return;
        }

        // Иначе — обрабатываем как FAQ-запрос (без вызова sendMessage, чтобы не дублировать)
        setTimeout(() => {
          const botId = `b${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          let botReply: ChatMessage;
          try {
            const faqMatch = simpleFaqMatch(reply.label);
            if (faqMatch) {
              botReply = {
                id: botId,
                roomId,
                senderId: "bot",
                senderName: "Уездный помощник",
                senderAvatar: "/logo.png",
                text: faqMatch.answer,
                createdAt: new Date().toISOString(),
                isBot: true,
                botKind: "faq",
                quickReplies: faqMatch.quickReplies,
              };
            } else {
              botReply = {
                id: botId,
                roomId,
                senderId: "bot",
                senderName: "Уездный помощник",
                senderAvatar: "/logo.png",
                text: "🤔 Я не уверен, что правильно понял вопрос. Переформулируйте, пожалуйста, или выберите тему ниже:",
                createdAt: new Date().toISOString(),
                isBot: true,
                botKind: "faq",
                quickReplies: DEFAULT_QUICK_REPLIES,
              };
            }
          } catch {
            botReply = {
              id: botId,
              roomId,
              senderId: "bot",
              senderName: "Уездный помощник",
              senderAvatar: "/logo.png",
              text: "Спасибо за сообщение! Оператор ответит в ближайшее время.",
              createdAt: new Date().toISOString(),
              isBot: true,
            };
          }
          set({ chatMessages: [...get().chatMessages, botReply] });
        }, 800);
      },

      setCakeBuilderOpen: (open) => set({ cakeBuilderOpen: open }),
      updateCakeBuilder: (state) =>
        set({ cakeBuilder: { ...get().cakeBuilder, ...state } }),
      resetCakeBuilder: () =>
        set({ cakeBuilder: { step: 0, decorations: [], dietary: [], productType: undefined, servings: undefined, quantity: undefined } }),

      setUserLocation: (location) => set({ userLocation: location }),
      setUserCity: (city) => {
        if (city) {
          set({
            userCity: city,
            userLocation: {
              country: "Россия",
              region: city,
              city: city,
            },
          });
        } else {
          set({ userCity: null });
        }
      },
      detectUserLocation: async () => {
        if (typeof window === "undefined" || !navigator.geolocation) return;
        return new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              set({
                userLocation: {
                  country: "Россия",
                  region: "Москва",
                  city: "Москва",
                  lat: position.coords.latitude,
                  lng: position.coords.longitude,
                },
              });
              resolve();
            },
            () => resolve(),
            { timeout: 5000 }
          );
        });
      },

      updateOrderStatus: (orderId, status) => {
        set({
          orders: get().orders.map((o) =>
            o.id === orderId ? { ...o, status: status as any } : o
          ),
        });
      },

      updateTaskStatus: (taskId, status) => {
        set({
          teamTasks: get().teamTasks.map((t) =>
            t.id === taskId ? { ...t, status: status as any } : t
          ),
        });
      },

      respondToInquiry: (inquiryId, price) => {
        set({
          inquiries: get().inquiries.map((i) =>
            i.id === inquiryId ? { ...i, status: "quoted" as const } : i
          ),
        });
      },

      // ===== Promotions =====
      createPromotion: (promo) => {
        const newPromo: Promotion = {
          ...promo,
          id: `pr${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 10),
          views: 0,
          clicks: 0,
          conversions: 0,
          usedCount: 0,
        };
        set({ promotions: [newPromo, ...get().promotions] });
      },
      updatePromotion: (id, updates) => {
        set({
          promotions: get().promotions.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        });
      },
      deletePromotion: (id) => {
        set({ promotions: get().promotions.filter((p) => p.id !== id) });
      },
      promotePromotion: (id, budget, regions) => {
        const promotedUntil = new Date();
        promotedUntil.setDate(promotedUntil.getDate() + 30);
        set({
          promotions: get().promotions.map((p) =>
            p.id === id
              ? {
                  ...p,
                  isPromoted: true,
                  promotionBudget: budget,
                  promotedRegions: regions,
                  promotedUntil: promotedUntil.toISOString().slice(0, 10),
                }
              : p
          ),
        });
      },

      // ===== Recipes =====
      createRecipe: (recipe) => {
        const newRecipe: Recipe = {
          ...recipe,
          id: `rc${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 10),
          views: 0,
          likes: 0,
          comments: 0,
        };
        set({ recipes: [newRecipe, ...get().recipes] });
      },
      updateRecipe: (id, updates) => {
        set({
          recipes: get().recipes.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        });
      },
      deleteRecipe: (id) => {
        set({ recipes: get().recipes.filter((r) => r.id !== id) });
      },

      // ===== Inventory =====
      addInventoryItem: (item) => {
        const newItem: InventoryItem = {
          ...item,
          id: `inv${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set({ inventory: [newItem, ...get().inventory] });
      },
      updateInventoryItem: (id, updates) => {
        set({
          inventory: get().inventory.map((i) =>
            i.id === id
              ? { ...i, ...updates, updatedAt: new Date().toISOString() }
              : i
          ),
        });
      },
      deleteInventoryItem: (id) => {
        set({ inventory: get().inventory.filter((i) => i.id !== id) });
      },
      addStockMovement: (movement) => {
        const newMovement: StockMovement = {
          ...movement,
          id: `sm${Date.now()}`,
          date: new Date().toISOString(),
        };
        // Обновляем количество на складе
        const item = get().inventory.find((i) => i.id === movement.itemId);
        if (item) {
          const delta =
            movement.type === "incoming"
              ? movement.quantity
              : movement.type === "outgoing" || movement.type === "waste"
              ? -movement.quantity
              : 0;
          get().updateInventoryItem(item.id, {
            quantity: Math.max(0, item.quantity + delta),
            lastRestocked:
              movement.type === "incoming"
                ? newMovement.date
                : item.lastRestocked,
          });
        }
        set({ stockMovements: [newMovement, ...get().stockMovements] });
      },

      // ===== Gantt =====
      updateGanttTask: (id, updates) => {
        set({
          ganttTasks: get().ganttTasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        });
      },
      addGanttTask: (task) => {
        const newTask: GanttTask = { ...task, id: `g${Date.now()}` };
        set({ ganttTasks: [...get().ganttTasks, newTask] });
      },

      // ===== Reminders =====
      markReminderRead: (id) => {
        set({
          reminders: get().reminders.map((r) =>
            r.id === id ? { ...r, isRead: true } : r
          ),
        });
      },
      markReminderDone: (id) => {
        set({
          reminders: get().reminders.map((r) =>
            r.id === id ? { ...r, isDone: true, isRead: true } : r
          ),
        });
      },
      addReminder: (reminder) => {
        const newReminder: Reminder = {
          ...reminder,
          id: `rm${Date.now()}`,
          createdAt: new Date().toISOString(),
          isRead: false,
          isDone: false,
        };
        set({ reminders: [newReminder, ...get().reminders] });
      },

      // ===== Promo popup =====
      showPromoPopup: () => set({ promoPopupShown: true }),
      dismissPromoPopup: (promotionId) => {
        set({
          promoPopupShown: false,
          promoPopupDismissed: [...new Set([...get().promoPopupDismissed, promotionId])],
        });
      },

      // ===== Corporate events =====
      createCorporateEvent: (event) => {
        const newEvent: CorporateEvent = {
          ...event,
          id: `ce${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 10),
          responsesCount: 0,
        };
        set({ corporateEvents: [newEvent, ...get().corporateEvents] });
      },
      updateCorporateEvent: (id, updates) => {
        set({
          corporateEvents: get().corporateEvents.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        });
      },
      respondToCorporateEvent: (eventId, _confectionerId) => {
        set({
          corporateEvents: get().corporateEvents.map((e) =>
            e.id === eventId ? { ...e, responsesCount: e.responsesCount + 1 } : e
          ),
        });
      },

      // ===== Blacklist =====
      addToBlacklist: (entry) => {
        const newEntry: BlacklistEntry = {
          ...entry,
          id: `bl${Date.now()}`,
          blockedAt: new Date().toISOString().slice(0, 10),
        };
        set({ blacklist: [newEntry, ...get().blacklist] });
      },
      removeFromBlacklist: (id) => {
        set({
          blacklist: get().blacklist.map((b) =>
            b.id === id ? { ...b, status: "lifted" as const } : b
          ),
        });
      },
      appealBlacklist: (id, text) => {
        const appeal = {
          id: `ap${Date.now()}`,
          text,
          createdAt: new Date().toISOString().slice(0, 10),
          status: "pending" as const,
        };
        set({
          blacklist: get().blacklist.map((b) =>
            b.id === id
              ? { ...b, status: "appealed" as const, appeals: [...(b.appeals || []), appeal] }
              : b
          ),
        });
      },
      checkBlacklist: (value, scope) => {
        const normalized = value.toLowerCase().trim();
        return (
          get().blacklist.find(
            (b) =>
              b.status === "active" &&
              b.value.toLowerCase().trim() === normalized &&
              (!scope || b.scope === scope)
          ) || null
        );
      },

      // ===== Semaphore =====
      checkSemaphore: (type, value) => {
        const normalized = value.toLowerCase().trim();
        const entry = get().semaphores.find(
          (s) => s.type === type && s.value.toLowerCase().trim() === normalized
        );
        if (entry) {
          return { available: false, existingUser: entry.userId };
        }
        return { available: true };
      },
      registerSemaphore: (type, value, userId) => {
        const normalized = value.trim();
        const existing = get().semaphores.find(
          (s) => s.type === type && s.value.toLowerCase().trim() === normalized.toLowerCase()
        );
        if (existing) {
          // Увеличиваем счётчик попыток
          set({
            semaphores: get().semaphores.map((s) =>
              s.id === existing.id
                ? { ...s, attempts: s.attempts + 1, lastAttemptAt: new Date().toISOString() }
                : s
            ),
          });
        } else {
          const newEntry: SemaphoreEntry = {
            id: `s${Date.now()}`,
            type,
            value: normalized,
            userId,
            verified: false,
            registeredAt: new Date().toISOString().slice(0, 10),
            attempts: 1,
          };
          set({ semaphores: [...get().semaphores, newEntry] });
        }
      },

      // ===== User legal info =====
      updateUserLegalInfo: (userId, legalInfo) => {
        set({
          user: get().user?.id === userId
            ? { ...get().user!, legalInfo, accountType: "legal" }
            : get().user,
        });
      },
      updateUserAccountType: (userId, accountType) => {
        set({
          user: get().user?.id === userId
            ? { ...get().user!, accountType }
            : get().user,
        });
      },

      // ===== Register new user (с семафором) =====
      registerUser: (data) => {
        // Проверка семафора — уникальность email
        const emailCheck = get().checkSemaphore("email", data.email);
        if (!emailCheck.available) {
          return { success: false, error: "Email уже зарегистрирован" };
        }
        // Проверка семафора — уникальность телефона
        const phoneCheck = get().checkSemaphore("phone", data.phone);
        if (!phoneCheck.available) {
          return { success: false, error: "Телефон уже зарегистрирован" };
        }
        // Проверка чёрного списка
        const emailBlacklist = get().checkBlacklist(data.email, "email");
        if (emailBlacklist) {
          return { success: false, error: `Email в чёрном списке: ${emailBlacklist.reasonDetails}` };
        }
        const phoneBlacklist = get().checkBlacklist(data.phone, "phone");
        if (phoneBlacklist) {
          return { success: false, error: `Телефон в чёрном списке: ${phoneBlacklist.reasonDetails}` };
        }

        // Создаём пользователя
        const newUserId = `u${Date.now()}`;
        const newUser: User = {
          id: newUserId,
          email: data.email,
          name: data.name,
          phone: data.phone,
          avatar: `https://i.pravatar.cc/150?u=${newUserId}`,
          roles: [data.role],
          createdAt: new Date().toISOString().slice(0, 10),
          accountType: data.accountType,
          legalInfo: data.legalInfo,
          loyaltyLevel: "BRONZE",
          bonusBalance: 0,
        };

        // Регистрируем в семафоре
        get().registerSemaphore("email", data.email, newUserId);
        get().registerSemaphore("phone", data.phone, newUserId);

        // Логиним
        set({
          user: newUser,
          activeRole: data.role,
          isAuthenticated: true,
          authModalOpen: false,
        });

        return { success: true };
      },

      // ===== Holidays =====
      addHoliday: (holiday) => {
        const newHoliday: UserHoliday = {
          ...holiday,
          id: `uh${Date.now()}`,
          userId: get().user?.id || "u1",
        };
        set({ userHolidays: [...get().userHolidays, newHoliday] });
      },
      deleteHoliday: (id) => {
        set({ userHolidays: get().userHolidays.filter((h) => h.id !== id) });
      },

      // ===== Gift certificates =====
      purchaseGiftCertificate: (cert) => {
        const newCert: GiftCertificate = {
          ...cert,
          id: `gc${Date.now()}`,
          code: `UK-GIFT-2026-${String(get().giftCertificates.length + 1).padStart(3, "0")}`,
          purchasedAt: new Date().toISOString().slice(0, 10),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          status: "active",
          remainingAmount: cert.amount,
        };
        set({ giftCertificates: [newCert, ...get().giftCertificates] });
      },

      // ===== Referral =====
      copyReferralLink: () => {
        const ref = get().referral;
        return ref?.referralLink || "";
      },

      // ===== Video reviews =====
      addVideoReview: (review) => {
        const newReview: VideoReview = {
          ...review,
          id: `vr${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 10),
          views: 0,
          likes: 0,
        };
        set({ videoReviews: [newReview, ...get().videoReviews] });
      },

      // ===== CMS =====
      updateCmsPage: (id, updates) => {
        set({
          cmsPages: get().cmsPages.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString().slice(0, 10) } : p
          ),
        });
      },
      updateCmsBlock: (id, updates) => {
        set({
          cmsBlocks: get().cmsBlocks.map((b) =>
            b.id === id ? { ...b, ...updates, updatedAt: new Date().toISOString().slice(0, 10) } : b
          ),
        });
      },
      addCmsBlock: (block) => {
        const newBlock = { ...block, id: `cms_b${Date.now()}`, updatedAt: new Date().toISOString().slice(0, 10) };
        set({ cmsBlocks: [...get().cmsBlocks, newBlock] });
      },
      deleteCmsBlock: (id) => {
        set({ cmsBlocks: get().cmsBlocks.filter((b) => b.id !== id) });
      },
      updateBanner: (id, updates) => {
        set({
          banners: get().banners.map((b) =>
            b.id === id ? { ...b, ...updates, updatedAt: new Date().toISOString().slice(0, 10) } : b
          ),
        });
      },
      addBanner: (banner) => {
        const newBanner = {
          ...banner,
          id: `bn${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
        };
        set({ banners: [newBanner, ...get().banners] });
      },
      deleteBanner: (id) => {
        set({ banners: get().banners.filter((b) => b.id !== id) });
      },
      updateSiteSetting: (key, value) => {
        set({
          siteSettings: get().siteSettings.map((s) =>
            s.key === key ? { ...s, value, updatedAt: new Date().toISOString().slice(0, 10) } : s
          ),
        });
      },
      updateNavMenu: (items) => {
        set({ navMenu: items });
      },
      approveReview: (id) => {
        set({
          reviewsModeration: get().reviewsModeration.map((r) =>
            r.id === id ? { ...r, status: "approved" } : r
          ),
        });
      },
      rejectReview: (id, reason) => {
        set({
          reviewsModeration: get().reviewsModeration.map((r) =>
            r.id === id ? { ...r, status: "rejected", rejectReason: reason } : r
          ),
        });
      },

      // ===== Согласование заказов =====
      quoteNegotiation: (id, items, total, comment, deliveryCost, prepTime) => {
        const now = new Date().toISOString();
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 7);
        set({
          negotiations: get().negotiations.map((n) =>
            n.id === id
              ? {
                  ...n,
                  quotedItems: items,
                  quotedTotal: total,
                  quotedComment: comment,
                  quotedDeliveryCost: deliveryCost,
                  quotedPrepTime: prepTime,
                  quotedAt: now,
                  status: "pending_customer" as NegotiationStatus,
                  validUntil: validUntil.toISOString(),
                  updatedAt: now,
                  revisions: [
                    ...n.revisions,
                    {
                      id: `rev${Date.now()}`,
                      at: now,
                      by: "confectioner" as const,
                      action: "Отправлено предложение",
                      oldTotal: n.quotedTotal || n.originalRequest.estimatedPrice,
                      newTotal: total,
                      comment,
                    },
                  ],
                }
              : n
          ),
        });
      },

      approveNegotiation: (id, comment) => {
        const now = new Date().toISOString();
        set({
          negotiations: get().negotiations.map((n) =>
            n.id === id
              ? {
                  ...n,
                  status: "approved" as NegotiationStatus,
                  customerResponse: "approved" as const,
                  customerComment: comment,
                  customerRespondedAt: now,
                  updatedAt: now,
                  revisions: [
                    ...n.revisions,
                    {
                      id: `rev${Date.now()}`,
                      at: now,
                      by: "customer" as const,
                      action: "Одобрено покупателем",
                      comment: comment || "Согласован, готов к оплате",
                    },
                  ],
                }
              : n
          ),
        });
      },

      rejectNegotiation: (id, comment) => {
        const now = new Date().toISOString();
        set({
          negotiations: get().negotiations.map((n) =>
            n.id === id
              ? {
                  ...n,
                  status: "rejected" as NegotiationStatus,
                  customerResponse: "rejected" as const,
                  customerComment: comment,
                  customerRespondedAt: now,
                  updatedAt: now,
                  revisions: [
                    ...n.revisions,
                    {
                      id: `rev${Date.now()}`,
                      at: now,
                      by: "customer" as const,
                      action: "Отклонено покупателем",
                      comment,
                    },
                  ],
                }
              : n
          ),
        });
      },

      reviseNegotiation: (id, items, total, comment, deliveryCost, prepTime) => {
        const now = new Date().toISOString();
        set({
          negotiations: get().negotiations.map((n) =>
            n.id === id
              ? {
                  ...n,
                  quotedItems: items,
                  quotedTotal: total,
                  quotedComment: comment,
                  quotedDeliveryCost: deliveryCost,
                  quotedPrepTime: prepTime,
                  quotedAt: now,
                  status: "pending_customer" as NegotiationStatus,
                  customerResponse: undefined,
                  customerComment: undefined,
                  customerRespondedAt: undefined,
                  updatedAt: now,
                  revisions: [
                    ...n.revisions,
                    {
                      id: `rev${Date.now()}`,
                      at: now,
                      by: "confectioner" as const,
                      action: "Пересмотрено предложение",
                      oldTotal: n.quotedTotal,
                      newTotal: total,
                      comment,
                    },
                  ],
                }
              : n
          ),
        });
      },

      createNegotiationFromInquiry: (inquiryId, confectionerId) => {
        const inquiry = get().inquiries.find((i) => i.id === inquiryId);
        if (!inquiry) return;
        const confectioner = get().confectioners.find((c) => c.id === confectionerId);
        if (!confectioner) return;
        const now = new Date().toISOString();
        const newNeg: OrderNegotiation = {
          id: `neg${Date.now()}`,
          inquiryId,
          customerId: "u_new",
          customerName: inquiry.customerName,
          customerAvatar: inquiry.customerAvatar,
          confectionerId,
          confectionerName: confectioner.businessName,
          confectionerAvatar: confectioner.avatar,
          originalRequest: {
            eventType: inquiry.eventType,
            base: inquiry.base,
            filling: inquiry.filling,
            coating: inquiry.coating,
            decorations: inquiry.decorations,
            servings: inquiry.servings,
            city: inquiry.city,
            deliveryDate: inquiry.deliveryDate,
            deliveryType: "delivery",
            comment: inquiry.comment,
            estimatedPrice: inquiry.budget,
          },
          quotedItems: [],
          quotedTotal: 0,
          quotedDeliveryCost: 0,
          quotedPrepTime: "",
          status: "pending_confectioner",
          createdAt: now,
          updatedAt: now,
          revisions: [
            {
              id: `rev${Date.now()}`,
              at: now,
              by: "customer",
              action: "Создана заявка из конструктора",
              comment: `Оценка: ${inquiry.budget}₽`,
            },
          ],
        };
        set({ negotiations: [newNeg, ...get().negotiations] });
      },

      // ===== Смена тарифа кондитера =====
      updateConfectionerTariff: (confectionerId, tariff) => {
        set({
          confectioners: get().confectioners.map((c) =>
            c.id === confectionerId ? { ...c, tariff } : c
          ),
        });
      },

      // ===== Работы кондитеров (портфолио) =====
      addConfectionerWork: (work) => {
        const newWork: ConfectionerWork = {
          ...work,
          id: `work_${Date.now()}`,
          createdAt: new Date().toISOString(),
          views: 0,
          likes: 0,
          images: work.images || [],
          tags: work.tags || [],
          decorations: work.decorations || [],
          status: "published" as const,
          featured: false,
        };
        set({ confectionerWorks: [newWork, ...get().confectionerWorks] });
      },

      updateConfectionerWork: (id, updates) => {
        set({
          confectionerWorks: get().confectionerWorks.map((w) =>
            w.id === id ? { ...w, ...updates } : w
          ),
        });
      },

      deleteConfectionerWork: (id) => {
        set({ confectionerWorks: get().confectionerWorks.filter((w) => w.id !== id) });
      },

      toggleWorkFeatured: (id) => {
        set({
          confectionerWorks: get().confectionerWorks.map((w) =>
            w.id === id ? { ...w, featured: !w.featured } : w
          ),
        });
      },

      likeConfectionerWork: (id) => {
        set({
          confectionerWorks: get().confectionerWorks.map((w) =>
            w.id === id ? { ...w, likes: w.likes + 1 } : w
          ),
        });
      },

      // ===== Fraud reports =====
      resolveFraudReport: (id, resolution) => {
        set({
          fraudReports: get().fraudReports.map((r) =>
            r.id === id ? { ...r, status: "resolved" as const, resolution, resolvedAt: new Date().toISOString() } : r
          ),
        });
      },

      assignFraudReport: (id, assignedTo) => {
        set({
          fraudReports: get().fraudReports.map((r) =>
            r.id === id ? { ...r, status: "investigating" as const, assignedTo } : r
          ),
        });
      },

      toggleFraudRule: (id) => {
        set({
          fraudRules: get().fraudRules.map((r) =>
            r.id === id ? { ...r, enabled: !r.enabled } : r
          ),
        });
      },

      calculateRiskScore: (userId) => {
        const userReports = get().fraudReports.filter((r) => r.targetUserId === userId);
        return Math.min(100, userReports.length * 25);
      },

      createFraudReport: (report) => {
        const newReport: FraudReport = {
          ...report,
          id: `fraud_${Date.now()}`,
          reportedAt: new Date().toISOString(),
          riskScore: 0,
          status: "new" as const,
        };
        set({ fraudReports: [newReport, ...get().fraudReports] });
      },

      withdrawNegotiation: (id) => {
        const now = new Date().toISOString();
        set({
          negotiations: get().negotiations.map((n) =>
            n.id === id
              ? {
                  ...n,
                  status: "pending_confectioner" as NegotiationStatus,
                  quotedItems: [],
                  quotedTotal: 0,
                  quotedComment: undefined,
                  quotedAt: undefined,
                  customerResponse: undefined,
                  customerComment: undefined,
                  customerRespondedAt: undefined,
                  updatedAt: now,
                  revisions: [
                    ...n.revisions,
                    {
                      id: `rev${Date.now()}`,
                      at: now,
                      by: "confectioner" as const,
                      action: "Предложение отозвано",
                      comment: "Кондитер отозвал предложение",
                    },
                  ],
                }
              : n
          ),
        });
      },

      // ===== Канал: лайки, комментарии, сторис, подписки =====
      togglePostLike: (postId) => {
        set({
          channelPosts: get().channelPosts.map((p) => {
            if (p.id !== postId) return p;
            const wasLiked = p.liked || false;
            return {
              ...p,
              liked: !wasLiked,
              likes: wasLiked ? p.likes - 1 : p.likes + 1,
            };
          }),
        });
      },

      addPostComment: (postId, text) => {
        const user = get().user;
        if (!user || !text.trim()) return;
        const newComment: ChannelComment = {
          id: `cc${Date.now()}`,
          postId,
          userId: user.id,
          userName: user.name,
          userAvatar: user.avatar,
          text: text.trim(),
          createdAt: new Date().toISOString(),
          likes: 0,
        };
        set({
          channelPosts: get().channelPosts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: p.comments + 1,
                  postComments: [...(p.postComments || []), newComment],
                }
              : p
          ),
        });
      },

      toggleCommentLike: (commentId) => {
        set({
          channelPosts: get().channelPosts.map((p) => ({
            ...p,
            postComments: p.postComments?.map((c) => {
              if (c.id !== commentId) return c;
              const wasLiked = c.liked || false;
              return {
                ...c,
                liked: !wasLiked,
                likes: wasLiked ? c.likes - 1 : c.likes + 1,
              };
            }),
          })),
        });
      },

      viewStory: (storyId) => {
        set({
          channelStories: get().channelStories.map((s) =>
            s.id === storyId ? { ...s, viewed: true, views: s.views + 1 } : s
          ),
        });
      },

      toggleFollow: (confectionerId) => {
        const user = get().user;
        if (!user) return;
        const existing = get().channelFollowers.find(
          (f) => f.confectionerId === confectionerId && f.userId === user.id
        );
        if (existing) {
          // Отписка
          set({
            channelFollowers: get().channelFollowers.filter((f) => f.id !== existing.id),
          });
        } else {
          // Подписка
          const newFollower: ChannelFollower = {
            id: `cf${Date.now()}`,
            confectionerId,
            userId: user.id,
            userName: user.name,
            userAvatar: user.avatar,
            followedAt: new Date().toISOString().slice(0, 10),
            isFollowing: false,
          };
          set({ channelFollowers: [...get().channelFollowers, newFollower] });
        }
      },

      isFollowing: (confectionerId) => {
        const user = get().user;
        if (!user) return false;
        return get().channelFollowers.some(
          (f) => f.confectionerId === confectionerId && f.userId === user.id
        );
      },

      // ===== Venue owner (заглушки) =====
      getVenueByOwner: (ownerId) => {
        return get().venues.find((v: any) => v.ownerId === ownerId) || null;
      },
      priceLists: [],
      addVenueService: (service) => {
        set({ venueServices: [...get().venueServices, service] });
      },
      updateVenueService: (id, updates) => {
        set({
          venueServices: get().venueServices.map((s: any) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        });
      },
      deleteVenueService: (id) => {
        set({ venueServices: get().venueServices.filter((s: any) => s.id !== id) });
      },
      toggleVenueServiceFeatured: (id) => {
        set({
          venueServices: get().venueServices.map((s: any) =>
            s.id === id ? { ...s, featured: !s.featured } : s
          ),
        });
      },

      addPriceList: (priceList) => {
        set({ priceLists: [...get().priceLists, priceList] });
      },

      addPriceListItem: (priceListId, item) => {
        set({
          priceLists: get().priceLists.map((pl: any) =>
            pl.id === priceListId
              ? { ...pl, items: [...(pl.items || []), item] }
              : pl
          ),
        });
      },

      deletePriceListItem: (priceListId, itemId) => {
        set({
          priceLists: get().priceLists.map((pl: any) =>
            pl.id === priceListId
              ? { ...pl, items: (pl.items || []).filter((i: any) => i.id !== itemId) }
              : pl
          ),
        });
      },

      convertPriceItemToService: (priceListId, itemId) => {
        const priceList = get().priceLists.find((pl: any) => pl.id === priceListId);
        if (!priceList) return;
        const item = (priceList.items || []).find((i: any) => i.id === itemId);
        if (!item) return;
        const newService: any = {
          id: `svc_${Date.now()}`,
          venueId: priceList.venueId,
          venueName: priceList.venueName,
          title: item.name || item.serviceName || "Услуга",
          description: item.description || "",
          category: item.category || "other",
          price: item.price,
          priceUnit: item.priceUnit || item.unit || "item",
          available: true,
          featured: false,
        };
        set({
          venueServices: [newService, ...get().venueServices],
          priceLists: get().priceLists.map((pl: any) =>
            pl.id === priceListId
              ? { ...pl, items: (pl.items || []).filter((i: any) => i.id !== itemId) }
              : pl
          ),
        });
      },
    }),
    {
      name: "conditera-storage",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      partialize: (state) => ({
        user: state.user,
        activeRole: state.activeRole,
        isAuthenticated: state.isAuthenticated,
        cart: state.cart,
        favorites: state.favorites,
        theme: state.theme,
        userCity: state.userCity,
        userLocation: state.userLocation,
        // История чата сохраняется, чтобы при перезагрузке страницы пользователь видел предыдущие сообщения
        chatMessages: (state.chatMessages || []).slice(-500), // последние 500 сообщений
        activeChatRoom: state.activeChatRoom,
      }),
    }
  )
);

// Expose store on window for debugging / e2e test automation (dev only)
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
   
  (window as any).useAppStore = useAppStore;
}

function getDashboardView(role: Role): NavState["view"] {
  switch (role) {
    case "CUSTOMER":
      return "dashboard-customer";
    case "CONFECTIONER":
    case "STUDIO":
      return "dashboard-confectioner";
    case "SUPPLIER":
      return "dashboard-supplier";
    case "COURIER":
      return "dashboard-courier";
    case "ADMIN":
    case "SUPER_ADMIN":
    case "MODERATOR":
    case "SUPPORT":
      return "dashboard-admin";
    case "FOOD_SERVICE":
    case "EVENT_ORGANIZER":
    case "BLOGGER":
    case "PICKUP_POINT":
    case "WHOLESALER":
    case "TASTER":
    case "FRANCHISEE":
    case "NUTRITIONIST":
    case "CORPORATE_CLIENT":
    case "QUALITY_INSPECTOR":
    case "CERTIFICATION_AGENT":
    case "COPYWRITER":
      return "dashboard-extra";
    default:
      return "home";
  }
}
