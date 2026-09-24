/**
 * types.ts — TypeScript типы для Supabase.
 *
 * В v2.0 (после подключения Supabase к проекту) типы будут генерироваться
 * автоматически из схемы БД через:
 *   supabase gen types typescript --project-id conditera > src/lib/supabase/types.ts
 *
 * Пока что используются ручные типы для совместимости.
 */

// Enums (должны совпадать с миграцией 0001_init.sql и 0011_rbac_franchise_escrow.sql)
export type user_role =
  | "CUSTOMER"
  | "CONFECTIONER"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "COURIER"
  | "SUPPLIER"
  | "VENUE_OWNER"
  | "ANIMATOR_AGENCY"
  | "RECREATION_CENTER"
  | "KIDS_CLUB"
  | "GUEST"
  | "MODERATOR"
  | "SUPPORT"
  | "STUDIO"
  | "BLOGGER"
  | "TASTER"
  | "FRANCHISEE"
  | "NUTRITIONIST"
  | "CORPORATE_CLIENT"
  | "QUALITY_INSPECTOR"
  | "CERTIFICATION_AGENT"
  | "COPYWRITER"
  | "FOOD_SERVICE"
  | "EVENT_ORGANIZER"
  | "PICKUP_POINT"
  | "WHOLESALER"
  | "INSPECTOR"
  // Новые роли v2.0 (PDF-спецификация «Архитектура ролевой экосистемы»):
  | "RECIPE_DEVELOPER"   // Создаёт авторские рецепты, получает роялти с продаж
  | "LOYALTY_PARTNER"   // Внешний партнёр (банки, страховые, кофейни) для кросс-акций
  | "AI_ASSISTANT";      // Виртуальный помощник для всех ролей (прогнозы, рекомендации, автоответы)

/**
 * Группировка ролей по функциональным категориям.
 * Используется в дашбордах и RBAC для группового назначения прав.
 * Источник: «Уездный кондитер v2.0 — Архитектура ролевой экосистемы», Часть I.
 */
export const ROLE_GROUPS = {
  CUSTOMERS: ["CUSTOMER", "CORPORATE_CLIENT", "GUEST"] as const,
  EXECUTORS: ["CONFECTIONER", "COURIER", "STUDIO", "ANIMATOR_AGENCY", "RECREATION_CENTER", "KIDS_CLUB"] as const,
  PARTNERS: ["SUPPLIER", "WHOLESALER", "VENUE_OWNER"] as const,
  CONTROL: ["MODERATOR", "QUALITY_INSPECTOR", "NUTRITIONIST", "CERTIFICATION_AGENT", "INSPECTOR"] as const,
  CONTENT: ["BLOGGER", "COPYWRITER", "TASTER"] as const,
  ADMINISTRATION: ["ADMIN", "SUPER_ADMIN", "SUPPORT"] as const,
  FRANCHISE: ["FRANCHISEE"] as const,
  NEW_ROLES: ["RECIPE_DEVELOPER", "LOYALTY_PARTNER", "AI_ASSISTANT"] as const,
} as const;

/**
 * Проверить, входит ли роль в указанную группу.
 * Используется в RBAC middleware для групповых проверок.
 */
export function isRoleInGroup(role: user_role, group: keyof typeof ROLE_GROUPS): boolean {
  return (ROLE_GROUPS[group] as readonly string[]).includes(role);
}

/**
 * Все роли системы (для справочников, дашбордов, RBAC UI).
 */
export const ALL_ROLES: user_role[] = [
  ...ROLE_GROUPS.CUSTOMERS,
  ...ROLE_GROUPS.EXECUTORS,
  ...ROLE_GROUPS.PARTNERS,
  ...ROLE_GROUPS.CONTROL,
  ...ROLE_GROUPS.CONTENT,
  ...ROLE_GROUPS.ADMINISTRATION,
  ...ROLE_GROUPS.FRANCHISE,
  ...ROLE_GROUPS.NEW_ROLES,
] as user_role[];

export type loyalty_level = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
// Schema 0017 enum: 'NEW' | 'VERIFIED' | 'MASTER' | 'EXPERT'
// + 'TRUSTED' — legacy значение из mock-data (src/lib/types.ts), оставлено для совместимости.
// БД не хранит 'TRUSTED' — при записи в confectioners используйте 'VERIFIED' (== 'TRUSTED' в mock).
export type trust_level = "NEW" | "VERIFIED" | "MASTER" | "EXPERT" | "TRUSTED";
export type account_type = "individual" | "legal";
// Schema 0017 enum: 'NPD' | 'USN' | 'OSNO' | 'PSN' | 'SELF_EMPLOYED'
// + 'IP' | 'OOO' — legacy значения из mock-data (старые поля в Confectioner.taxMode), оставлены для совместимости.
export type tax_mode = "NPD" | "USN" | "OSNO" | "PSN" | "SELF_EMPLOYED" | "IP" | "OOO";
// Schema 0017 enum: 'START' | 'BASIC' | 'PREMIUM' | 'BUSINESS'
// + 'PROFI' — legacy значение из mock-data, оставлено для совместимости.
export type tariff = "START" | "BASIC" | "PREMIUM" | "BUSINESS" | "PROFI";

export type order_status =
  | "PENDING"
  | "NEGOTIATING"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "IN_DELIVERY"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";

export type payment_status =
  | "pending"
  | "waiting_for_capture"
  | "succeeded"
  | "escrow"
  | "released"
  | "cancelled"
  | "refunded";

// ==================== Database table types ====================

export interface Profile {
  id: string;  // FK на auth.users.id
  email: string;
  name: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  blocked_at: string | null;
  loyalty_level: loyalty_level;
  bonus_balance: number;
  account_type: account_type;
  default_delivery_address: string | null;
  dietary_restrictions: string[] | null;
  allergens: string[] | null;
  preferred_payment_method: string | null;
  birth_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: user_role;
  is_active: boolean;
  assigned_at: string;
  assigned_by: string | null;
  deactivated_at: string | null;
}

export interface Address {
  id: string;
  user_id: string;
  label: string | null;
  text: string;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
  created_at: string;
}

export interface NotificationPreferences {
  user_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
  telegram_enabled: boolean;
  sms_enabled: boolean;
  in_app_enabled: boolean;
  order_created: boolean;
  order_status_changed: boolean;
  order_delivered: boolean;
  new_message: boolean;
  promotions: boolean;
  weekly_digest: boolean;
  updated_at: string;
}

// ==================== Helper types ====================

export interface UserWithRoles {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  roles: user_role[];
}

// ==================== Новые таблицы (миграция 0012) ====================
// Соответствуют схеме из PDF «Уездный кондитер v2.0 — Архитектура ролевой экосистемы»

/** Каталог авторских рецептов от RECIPE_DEVELOPER */
export interface RecipeMarketplace {
  id: string;
  author_id: string;
  title: string;
  slug: string;
  description: string;
  base_price: number;
  is_premium: boolean;
  premium_price: number | null;
  royalty_rate: number;  // 0.05 = 5%
  cooking_time_min: number | null;
  difficulty: 1 | 2 | 3 | 4 | 5 | null;
  tags: string[];
  preview_image: string | null;
  steps_json: Array<{
    step_number: number;
    description: string;
    image?: string;
    video_url?: string;
  }>;
  ingredients_json: Array<{
    name: string;
    qty: string;
    unit: string;
  }>;
  views: number;
  purchases_count: number;
  rating: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Покупка рецепта кондитером (для расчёта роялти) */
export interface RecipePurchase {
  id: string;
  recipe_id: string;
  buyer_id: string;
  price_paid: number;
  royalty_amount: number;
  commission_amount: number;
  payment_id: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

/** Премиум-подписка на все рецепты автора */
export interface RecipeSubscription {
  id: string;
  subscriber_id: string;
  author_id: string;
  price_per_month: number;
  status: "active" | "paused" | "cancelled" | "expired";
  current_period_start: string;
  current_period_end: string;
  next_renewal_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Внешний партнёр программы лояльности */
export interface LoyaltyPartner {
  id: string;
  user_id: string;
  company_name: string;
  company_type: "bank" | "insurance" | "coffee_chain" | "restaurant_chain" | "retail" | "other";
  inn: string | null;
  legal_address: string | null;
  contact_email: string;
  contact_phone: string | null;
  api_key_hash: string | null;
  api_key_scopes: string[];
  is_verified: boolean;
  is_active: boolean;
  partnership_started_at: string;
  partnership_ended_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Кросс-акция с внешним партнёром */
export interface LoyaltyCrossAction {
  id: string;
  partner_id: string;
  title: string;
  description: string;
  discount_type: "percent" | "fixed" | "bonus_points" | "freebie";
  discount_value: number;
  start_at: string;
  end_at: string;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Обмен бонусами между платформой и партнёром */
export interface LoyaltyPointExchange {
  id: string;
  user_id: string;
  partner_id: string;
  direction: "to_partner" | "from_partner";
  points_amount: number;
  external_txn_id: string | null;
  status: "pending" | "completed" | "failed" | "reversed";
  external_payload: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

/** Сохранённый диалог с AI-помощником по ролям */
export interface AIAssistantConversation {
  id: string;
  user_id: string;
  role_context: user_role;
  title: string | null;
  message_count: number;
  last_message_at: string | null;
  is_archived: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Лог запроса/ответа AI-помощника */
export interface AIAssistantLog {
  id: number;  // BIGSERIAL
  conversation_id: string | null;
  user_id: string | null;
  role_context: user_role | null;
  request_type: "chat" | "forecast" | "recommendation" | "auto_reply" | "voice" | "other";
  input_text: string;
  output_text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_used: string | null;
  latency_ms: number | null;
  was_helpful: boolean | null;
  feedback_text: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

// ==================== Confectioners (Schema 0017, camelCase) ====================

/**
 * Schema: public.confectioners (migration 0017_sync_missing_tables.sql)
 * Колонки в camelCase (Prisma-совместимые), RLS включена миграцией 0026.
 */
export interface ConfectionerRow {
  id: string;                          // TEXT PK
  userId: string;                      // TEXT NOT NULL
  businessName: string;                // TEXT NOT NULL
  slug: string;                        // TEXT NOT NULL, UNIQUE
  description: string;                 // TEXT NOT NULL
  avatar: string;                      // TEXT NOT NULL
  cover: string | null;                // TEXT
  city: string;                        // TEXT NOT NULL
  location: Record<string, unknown>;  // JSONB NOT NULL
  rating: number;                      // DOUBLE PRECISION
  reviewsCount: number;                // INTEGER
  ordersCount: number;                 // INTEGER
  verified: boolean;                   // BOOLEAN DEFAULT false
  verificationStatus: string;         // TEXT DEFAULT 'pending'
  verifiedBy: string | null;
  verifiedAt: string | null;           // TIMESTAMP(3)
  rejectionReason: string | null;
  trustLevel: trust_level;             // "TrustLevel" enum
  tariff: tariff;                      // "Tariff" enum
  legalInfo: Record<string, unknown>; // JSONB NOT NULL
  taxMode: tax_mode;                   // "TaxMode" enum
  specialization: string[] | null;     // TEXT[]
  portfolioImages: string[] | null;    // TEXT[]
  followersCount: number;              // INTEGER
  responseTime: string;                // TEXT
  joinedAt: string;                    // TIMESTAMP(3)
  selfPickup: boolean;
  deliveryOptions: string[] | null;   // TEXT[]
  paymentSettings: Record<string, unknown> | null; // JSONB
  ecoBadges: string[] | null;          // TEXT[]
  balance: number;                     // INTEGER (копейки)
  totalEarnings: number;               // INTEGER (копейки)
  monthlyEarnings: number;             // INTEGER (копейки)
  createdAt: string;                  // TIMESTAMP(3)
  updatedAt: string;                  // TIMESTAMP(3)
}

/**
 * Schema: public.confectioner_ateliers (migration 0017, camelCase).
 */
export interface ConfectionerAtelierRow {
  id: string;
  confectionerId: string;
  about: string | null;
  workshopPhotos: string[] | null;
  presentationVideo: string | null;
  equipment: unknown | null;          // JSONB
  experienceYears: number;
  education: unknown | null;          // JSONB
  certificates: unknown | null;
  awards: unknown | null;
  workingHours: unknown | null;
  teamSize: number;
  techniques: string[] | null;
  deliveryCities: string[] | null;
  serviceRadiusKm: number;
  socialLinks: unknown | null;
  totalStudents: number;
  totalLessons: number;
  createdAt: string;
  updatedAt: string;
}
