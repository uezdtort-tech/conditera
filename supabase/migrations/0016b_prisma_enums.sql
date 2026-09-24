-- 0019_prisma_enums_for_0017.sql
-- ============================================================================
-- Создаёт недостающие Prisma-style enum типы (CamelCase, в кавычках),
-- которые использует миграция 0017_sync_missing_tables.sql.
--
-- Контекст: 0017 — это дамп Prisma-схемы, где типы называются
-- "UserRole", "LoyaltyLevel", "AccountType", "TrustLevel", "Tariff",
-- "TaxMode", "MaintenanceType", "MaintenanceStatus".
-- Prisma ожидает, что они создаются в prisma/migrations/0001_full_schema.sql,
-- но в Supabase-окружении эти CamelCase типы не создаются — там используются
-- snake_case версии (user_role, loyalty_level, ...).
--
-- Эта миграция создаёт ВСЕ CamelCase enum'ы, которые нужны таблицам из 0017,
-- чтобы 0017 могла корректно применяться.
-- ============================================================================

-- Эти CREATE TYPE IF NOT EXISTS безопасны: если тип уже существует — пропускаем.
-- (IF NOT EXISTS для CREATE TYPE поддерживается в PostgreSQL 9.3+)

-- ── Роли пользователей ──
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM (
    'CUSTOMER', 'CONFECTIONER', 'ADMIN', 'SUPER_ADMIN',
    'COURIER', 'SUPPLIER', 'VENUE_OWNER', 'ANIMATOR_AGENCY',
    'RECREATION_CENTER', 'KIDS_CLUB', 'GUEST', 'MODERATOR',
    'SUPPORT', 'STUDIO', 'BLOGGER', 'TASTER', 'FRANCHISEE',
    'NUTRITIONIST', 'CORPORATE_CLIENT', 'QUALITY_INSPECTOR',
    'CERTIFICATION_AGENT', 'COPYWRITER', 'FOOD_SERVICE',
    'EVENT_ORGANIZER', 'PICKUP_POINT', 'WHOLESALER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Уровни лояльности ──
DO $$ BEGIN
  CREATE TYPE "LoyaltyLevel" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Тип аккаунта (физлицо / юрлицо) ──
DO $$ BEGIN
  CREATE TYPE "AccountType" AS ENUM ('individual', 'legal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Уровень доверия кондитера ──
DO $$ BEGIN
  CREATE TYPE "TrustLevel" AS ENUM ('NEW', 'VERIFIED', 'MASTER', 'EXPERT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Тариф кондитера ──
DO $$ BEGIN
  CREATE TYPE "Tariff" AS ENUM ('START', 'BASIC', 'PREMIUM', 'BUSINESS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Налоговый режим ──
DO $$ BEGIN
  CREATE TYPE "TaxMode" AS ENUM ('NPD', 'USN', 'OSNO', 'PSN', 'SELF_EMPLOYED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Статус заказа ──
DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM (
    'PENDING', 'NEGOTIATING', 'CONFIRMED', 'PREPARING',
    'READY', 'IN_DELIVERY', 'DELIVERED', 'COMPLETED',
    'CANCELLED', 'REFUNDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Статус платежа ──
DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM (
    'pending', 'waiting_for_capture', 'succeeded', 'escrow',
    'released', 'cancelled', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Способ платежа ──
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM (
    'card', 'sbp', 'cash', 'split', 'installment', 'yookassa', 'self'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Тип транзакции лояльности ──
DO $$ BEGIN
  CREATE TYPE "LoyaltyTxType" AS ENUM (
    'EARN', 'REDEEM', 'EXPIRE', 'REFUND', 'ADJUST',
    'BONUS_WELCOME', 'BONUS_BIRTHDAY', 'BONUS_REFERRAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Канал уведомления ──
DO $$ BEGIN
  CREATE TYPE "NotificationChannel" AS ENUM (
    'email', 'sms', 'push', 'in_app', 'telegram'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Статус уведомления ──
DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM (
    'queued', 'sent', 'delivered', 'failed', 'read', 'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Шаблон уведомления ──
DO $$ BEGIN
  CREATE TYPE "NotificationTemplate" AS ENUM (
    'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_STATUS_CHANGED',
    'ORDER_ACCEPTED', 'ORDER_IN_PRODUCTION', 'ORDER_READY',
    'ORDER_READY_FOR_PICKUP', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_RECEIVED',
    'ORDER_DELIVERED', 'ORDER_CANCELLED', 'PAYMENT_SUCCEEDED',
    'PAYMENT_PARTIAL', 'PAYMENT_FAILED', 'REFUND_PROCESSED',
    'NEGOTIATION_RECEIVED', 'NEGOTIATION_QUOTED', 'NEGOTIATION_APPROVED',
    'NEGOTIATION_REJECTED', 'NEW_MESSAGE', 'NEW_REVIEW', 'REVIEW_REPLY',
    'BONUS_EARNED', 'BONUS_EXPIRING', 'LEVEL_UP', 'BIRTHDAY_GREETING',
    'REFERRAL_REWARDED', 'PROMO_NEAR_YOU', 'ABANDONED_CART',
    'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED',
    'PAYOUT_PROCESSED', 'SUPPORT_REPLY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Статус организации (DaData) ──
DO $$ BEGIN
  CREATE TYPE "OrganizationStatus" AS ENUM (
    'ACTIVE', 'LIQUIDATING', 'LIQUIDATED', 'REORGANIZING', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Триггер верификации ──
DO $$ BEGIN
  CREATE TYPE "VerificationTrigger" AS ENUM (
    'REGISTRATION', 'PROFILE_UPDATE', 'INVOICE_ISSUE',
    'PAYOUT_REQUEST', 'CRON_PERIODIC', 'ADMIN_MANUAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Тип обслуживания ──
DO $$ BEGIN
  CREATE TYPE "MaintenanceType" AS ENUM (
    'BACKUP_FULL', 'BACKUP_INCREMENTAL', 'CLEANUP_LOGS',
    'CLEANUP_SESSIONS', 'CLEANUP_NOTIFICATIONS', 'CLEANUP_CARTS',
    'CLEANUP_ORPHANS', 'VACUUM'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Статус обслуживания ──
DO $$ BEGIN
  CREATE TYPE "MaintenanceStatus" AS ENUM (
    'queued', 'running', 'success', 'failed', 'partial'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Статус начинки (модерация) ──
DO $$ BEGIN
  CREATE TYPE "FillingStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Категория начинки ──
DO $$ BEGIN
  CREATE TYPE "FillingCategory" AS ENUM (
    'CREAM', 'CHOCOLATE', 'BERRY', 'CARAMEL', 'NUT',
    'FRUIT', 'CLASSIC', 'MOUSSE', 'CUSTARD', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Тип события аудита ──
DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM (
    'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
    'PERMISSION_GRANT', 'PERMISSION_REVOKE', 'BAN', 'UNBAN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE "UserRole" IS 'Роли пользователей (Prisma-style, CamelCase — используется таблицами из миграции 0017)';
