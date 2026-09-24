-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'CONFECTIONER', 'ADMIN', 'SUPER_ADMIN', 'COURIER', 'SUPPLIER', 'VENUE_OWNER', 'ANIMATOR_AGENCY', 'RECREATION_CENTER', 'KIDS_CLUB', 'GUEST', 'MODERATOR', 'SUPPORT', 'STUDIO', 'BLOGGER', 'TASTER', 'FRANCHISEE', 'NUTRITIONIST', 'CORPORATE_CLIENT', 'QUALITY_INSPECTOR', 'CERTIFICATION_AGENT', 'COPYWRITER', 'FOOD_SERVICE', 'EVENT_ORGANIZER', 'PICKUP_POINT', 'WHOLESALER');

-- CreateEnum
CREATE TYPE "LoyaltyLevel" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('individual', 'legal');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('NEW', 'VERIFIED', 'MASTER', 'EXPERT');

-- CreateEnum
CREATE TYPE "Tariff" AS ENUM ('START', 'BASIC', 'PREMIUM', 'BUSINESS');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('NPD', 'USN', 'OSNO', 'PSN', 'SELF_EMPLOYED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'NEGOTIATING', 'CONFIRMED', 'PREPARING', 'READY', 'IN_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'waiting_for_capture', 'succeeded', 'escrow', 'released', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'sbp', 'cash', 'split', 'installment', 'yookassa', 'self');

-- CreateEnum
CREATE TYPE "LoyaltyTxType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'REFUND', 'ADJUST', 'BONUS_WELCOME', 'BONUS_BIRTHDAY', 'BONUS_REFERRAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'sms', 'push', 'in_app', 'telegram');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'delivered', 'failed', 'read', 'dismissed');

-- CreateEnum
CREATE TYPE "NotificationTemplate" AS ENUM ('ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_STATUS_CHANGED', 'ORDER_ACCEPTED', 'ORDER_IN_PRODUCTION', 'ORDER_READY', 'ORDER_READY_FOR_PICKUP', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_RECEIVED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'PAYMENT_SUCCEEDED', 'PAYMENT_PARTIAL', 'PAYMENT_FAILED', 'REFUND_PROCESSED', 'NEGOTIATION_RECEIVED', 'NEGOTIATION_QUOTED', 'NEGOTIATION_APPROVED', 'NEGOTIATION_REJECTED', 'NEW_MESSAGE', 'NEW_REVIEW', 'REVIEW_REPLY', 'BONUS_EARNED', 'BONUS_EXPIRING', 'LEVEL_UP', 'BIRTHDAY_GREETING', 'REFERRAL_REWARDED', 'PROMO_NEAR_YOU', 'ABANDONED_CART', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED', 'PAYOUT_PROCESSED', 'SUPPORT_REPLY');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'LIQUIDATING', 'LIQUIDATED', 'REORGANIZING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VerificationTrigger" AS ENUM ('REGISTRATION', 'PROFILE_UPDATE', 'INVOICE_ISSUE', 'PAYOUT_REQUEST', 'CRON_PERIODIC', 'ADMIN_MANUAL');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('BACKUP_FULL', 'BACKUP_INCREMENTAL', 'CLEANUP_LOGS', 'CLEANUP_SESSIONS', 'CLEANUP_NOTIFICATIONS', 'CLEANUP_CARTS', 'CLEANUP_ORPHANS', 'VACUUM');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('queued', 'running', 'success', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "FillingStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "FillingCategory" AS ENUM ('CREAM', 'CHOCOLATE', 'BERRY', 'CARAMEL', 'NUT', 'FRUIT', 'CLASSIC', 'MOUSSE', 'CUSTARD', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar" TEXT,
    "roles" "UserRole"[] DEFAULT ARRAY['CUSTOMER']::"UserRole"[],
    "accountType" "AccountType" NOT NULL DEFAULT 'individual',
    "legalInfo" JSONB,
    "city" TEXT,
    "loyaltyLevel" "LoyaltyLevel" NOT NULL DEFAULT 'BRONZE',
    "bonusBalance" INTEGER NOT NULL DEFAULT 0,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "tfaSecret" TEXT,
    "tfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tfaRequiredFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLoginIp" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "botRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "orderUpdates" BOOLEAN NOT NULL DEFAULT true,
    "paymentUpdates" BOOLEAN NOT NULL DEFAULT true,
    "promos" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "reviews" BOOLEAN NOT NULL DEFAULT true,
    "loyalty" BOOLEAN NOT NULL DEFAULT true,
    "abandonedCart" BOOLEAN NOT NULL DEFAULT true,
    "digest" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 9,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "maxPerDay" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LoyaltyTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" INTEGER,
    "multiplier" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "category" TEXT NOT NULL DEFAULT 'orders',
    "condition" JSONB,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "rewardType" TEXT,
    "rewardValue" INTEGER,
    "awardedCount" INTEGER NOT NULL DEFAULT 0,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" JSONB,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "goalType" TEXT NOT NULL,
    "goalValue" INTEGER NOT NULL,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "rewardType" TEXT,
    "rewardValue" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "participantsCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "rewardClaimed" BOOLEAN NOT NULL DEFAULT false,
    "rewardClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "template" "NotificationTemplate" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'in_app',
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "externalId" TEXT,
    "errorMessage" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confectioners" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "avatar" TEXT NOT NULL,
    "cover" TEXT,
    "city" TEXT NOT NULL,
    "location" JSONB NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "trustLevel" "TrustLevel" NOT NULL DEFAULT 'NEW',
    "tariff" "Tariff" NOT NULL DEFAULT 'START',
    "legalInfo" JSONB NOT NULL,
    "taxMode" "TaxMode" NOT NULL DEFAULT 'NPD',
    "specialization" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "portfolioImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "responseTime" TEXT NOT NULL DEFAULT '',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selfPickup" BOOLEAN NOT NULL DEFAULT true,
    "deliveryOptions" TEXT[] DEFAULT ARRAY['own']::TEXT[],
    "paymentSettings" JSONB,
    "ecoBadges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarnings" INTEGER NOT NULL DEFAULT 0,
    "monthlyEarnings" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "confectioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "oldPrice" INTEGER,
    "category" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confectionerId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "weight" TEXT,
    "servings" INTEGER,
    "prepTime" TEXT,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "isHit" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fillings" JSONB,
    "coatings" JSONB,
    "decorations" JSONB,
    "paymentOptions" JSONB,
    "modelUrl" TEXT,
    "modelUsdzUrl" TEXT,
    "arEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "confectionerId" TEXT,
    "courierId" TEXT,
    "total" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryAddress" TEXT,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "deliveryTime" TEXT,
    "deliveryCost" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'card',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "escrowReleasedAt" TIMESTAMP(3),
    "tariffSnapshot" TEXT,
    "commissionRateSnapshot" DOUBLE PRECISION,
    "legalStatusSnapshot" TEXT,
    "bonusPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "bonusDiscountRub" INTEGER NOT NULL DEFAULT 0,
    "promoCodeApplied" TEXT,
    "promoCodeId" TEXT,
    "promoDiscount" INTEGER,
    "payoutTransferredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "customization" JSONB,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "customization" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "duration" INTEGER NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "promoCode" TEXT,
    "minOrderAmount" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "isPromoted" BOOLEAN NOT NULL DEFAULT false,
    "promotedUntil" TIMESTAMP(3),
    "promotionBudget" INTEGER,
    "image" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'recipe',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "prepTime" INTEGER NOT NULL DEFAULT 0,
    "cookTime" INTEGER NOT NULL DEFAULT 0,
    "difficulty" TEXT NOT NULL DEFAULT 'easy',
    "servings" INTEGER NOT NULL DEFAULT 1,
    "ingredients" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT NOT NULL DEFAULT '',
    "access" TEXT NOT NULL DEFAULT 'free',
    "price" INTEGER,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'direct',
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastMessage" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "botKind" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "totalInvited" INTEGER NOT NULL DEFAULT 0,
    "activeReferrals" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "availableBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_certificates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toPhone" TEXT,
    "message" TEXT,
    "design" TEXT NOT NULL DEFAULT 'classic',
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "remainingAmount" INTEGER,
    "deliveryMethod" TEXT NOT NULL DEFAULT 'email',
    "toUserId" TEXT,

    CONSTRAINT "gift_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_holidays" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'birthday',
    "date" TIMESTAMP(3) NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "personName" TEXT,
    "relationship" TEXT,
    "reminderDays" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "yookassaId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "confirmationUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklist" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT NOT NULL,
    "reasonDetails" TEXT NOT NULL,
    "blockedBy" TEXT NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPermanent" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semaphores" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semaphores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPerUnit" INTEGER NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "expiryDate" TIMESTAMP(3),
    "storageLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "costPerUnit" INTEGER,
    "totalCost" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_blocks" (
    "id" TEXT NOT NULL,
    "pageId" TEXT,
    "section" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "content" TEXT,
    "image" TEXT,
    "link" TEXT,
    "linkText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "cms_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "image" TEXT NOT NULL,
    "link" TEXT,
    "buttonText" TEXT,
    "position" TEXT NOT NULL DEFAULT 'hero',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nav_menu_items" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDropdown" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nav_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "confectionerId" TEXT,
    "inn" TEXT NOT NULL,
    "ogrn" TEXT,
    "kpp" TEXT,
    "companyName" TEXT NOT NULL,
    "fullName" TEXT,
    "opfCode" TEXT,
    "opfShort" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "managementName" TEXT,
    "managementPost" TEXT,
    "legalAddress" TEXT,
    "registeredAt" TIMESTAMP(3),
    "liquidatedAt" TIMESTAMP(3),
    "trigger" "VerificationTrigger" NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "rawData" JSONB,
    "actionTaken" TEXT,
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_logs" (
    "id" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordsAffected" INTEGER,
    "backupPath" TEXT,
    "backupSizeBytes" INTEGER,
    "tablesCount" INTEGER,
    "details" JSONB,
    "errorMessage" TEXT,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fillings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "FillingCategory" NOT NULL DEFAULT 'OTHER',
    "image" TEXT,
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consistency" TEXT,
    "color" TEXT,
    "sliceImage" TEXT,
    "sliceConfig" JSONB,
    "sliceConfigCreatedBy" TEXT,
    "suggestedPriceModifier" INTEGER NOT NULL DEFAULT 0,
    "status" "FillingStatus" NOT NULL DEFAULT 'APPROVED',
    "createdBy" TEXT,
    "createdByName" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fillings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_slices" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fillingName" TEXT NOT NULL,
    "image" TEXT,
    "config" JSONB,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_slices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_streams" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "streamUrl" TEXT,
    "streamKey" TEXT,
    "productId" TEXT,
    "viewersCount" INTEGER NOT NULL DEFAULT 0,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "totalViewers" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "recordUrl" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_stream_viewers" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "watchTime" INTEGER NOT NULL DEFAULT 0,
    "liked" BOOLEAN NOT NULL DEFAULT false,
    "ordered" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "live_stream_viewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_stream_orders" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_stream_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_stream_messages" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "userName" TEXT NOT NULL,
    "userAvatar" TEXT,
    "text" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_stream_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'percent',
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDiscountRub" INTEGER,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
    "applicableRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confectionerId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fraud_logs" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "deviceFp" TEXT,
    "userId" TEXT,
    "orderId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fraud_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_escalations" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedTo" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "tokenType" TEXT DEFAULT 'Bearer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'bike',
    "availability" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "region" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveriesCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "inn" TEXT,
    "deliveryTerms" TEXT,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loyaltyLevel" TEXT NOT NULL DEFAULT 'BRONZE',
    "bonusBalance" INTEGER NOT NULL DEFAULT 0,
    "preferences" JSONB,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blogger_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "conversionsCount" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "platform" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blogger_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taster_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certificates" JSONB,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taster_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchisee_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "royaltyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchisee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutritionist_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specializations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certificates" JSONB,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consultationsCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutritionist_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_client_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "inn" TEXT,
    "budget" INTEGER NOT NULL DEFAULT 0,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "managerName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspector_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certificates" JSONB,
    "inspectionsCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "region" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspector_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certification_agent_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "license" TEXT,
    "licenseExpiresAt" TIMESTAMP(3),
    "certificationsCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certification_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copywriter_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "articlesCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copywriter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderator_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "casesCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_organizer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "inn" TEXT,
    "eventsCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_organizer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_service_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "venueType" TEXT NOT NULL DEFAULT 'restaurant',
    "seats" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT,
    "inn" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_service_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studioName" TEXT NOT NULL,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_point_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "storageType" TEXT NOT NULL DEFAULT 'ambient',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "workingHours" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_point_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wholesaler_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "inn" TEXT,
    "volumePerMonth" INTEGER NOT NULL DEFAULT 0,
    "contractType" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wholesaler_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reports" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "muteUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_posts" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_stories" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "video" TEXT,
    "type" TEXT NOT NULL DEFAULT 'image',
    "caption" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "productId" TEXT,
    "promotionId" TEXT,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "viewedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_likes" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_replies" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_followers" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_followers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_likes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_tasks" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_events" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_activity_logs" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confectioner_transactions" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "orderId" TEXT,
    "balanceAfter" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confectioner_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "method" TEXT NOT NULL DEFAULT 'card',
    "destination" TEXT,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_expenses" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_contributions" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'pension',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_reports" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "income" INTEGER NOT NULL DEFAULT 0,
    "expenses" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "taxMode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "filedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "amount" INTEGER,
    "description" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tracking" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_locations" (
    "id" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_negotiations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "proposedPrice" INTEGER NOT NULL,
    "originalPrice" INTEGER,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_negotiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constructor_drafts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constructor_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_inquiries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftId" TEXT,
    "confectionerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responsesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wholesale_prices" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wholesale_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_orders" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cake_subscriptions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "schedule" TEXT NOT NULL DEFAULT 'monthly',
    "discountPercent" INTEGER NOT NULL DEFAULT 15,
    "servings" INTEGER NOT NULL DEFAULT 8,
    "pricePerDelivery" INTEGER NOT NULL,
    "deliveryAddress" TEXT,
    "deliveryCity" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'card',
    "yookassaPaymentId" TEXT,
    "nextDeliveryAt" TIMESTAMP(3) NOT NULL,
    "lastDeliveryAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancelReason" TEXT,
    "deliveriesCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cake_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confectioner_ateliers" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "about" TEXT,
    "workshopPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "presentationVideo" TEXT,
    "equipment" JSONB,
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "education" JSONB,
    "certificates" JSONB,
    "awards" JSONB,
    "workingHours" JSONB,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "techniques" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliveryCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serviceRadiusKm" INTEGER NOT NULL DEFAULT 0,
    "socialLinks" JSONB,
    "totalStudents" INTEGER NOT NULL DEFAULT 0,
    "totalLessons" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "confectioner_ateliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confectioner_lessons" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'video_lesson',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "videoUrl" TEXT,
    "videoDuration" INTEGER NOT NULL DEFAULT 0,
    "posterUrl" TEXT,
    "presentationUrl" TEXT,
    "chapters" JSONB,
    "materials" JSONB,
    "difficultyLevel" TEXT NOT NULL DEFAULT 'beginner',
    "price" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "enrolledCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejectionReason" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "maxParticipants" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "confectioner_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_enrollments" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paymentId" TEXT,
    "rating" INTEGER,
    "reviewText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'personal',
    "name" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 7,
    "lastNotifiedAt" TIMESTAMP(3),
    "preferredCategory" TEXT,
    "budgetRange" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_feed_items" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "posterUrl" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "sharesCount" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "audioTitle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_sections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_section_blocks" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_section_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT,
    "uploadedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_processing_queue" (
    "id" TEXT NOT NULL,
    "mediaFileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "params" JSONB,
    "resultUrl" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_processing_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_campaigns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'percent',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_usages" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_acceptances" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "priceFrom" INTEGER NOT NULL,
    "priceTo" INTEGER,
    "prepDays" INTEGER NOT NULL DEFAULT 3,
    "delivery" BOOLEAN NOT NULL DEFAULT true,
    "selfPickup" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simplex_contacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "simplexConnId" TEXT,
    "simplexAddress" TEXT,
    "simplexName" TEXT,
    "profileType" TEXT NOT NULL DEFAULT 'confectioner',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connectionsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simplex_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simplex_messages" (
    "id" TEXT NOT NULL,
    "simplexContactId" TEXT NOT NULL,
    "simplexChatId" TEXT NOT NULL,
    "simplexMsgId" TEXT NOT NULL,
    "fromName" TEXT,
    "text" TEXT,
    "metadata" JSONB,
    "direction" TEXT NOT NULL DEFAULT 'incoming',
    "readByOperator" BOOLEAN NOT NULL DEFAULT false,
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simplex_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_contexts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "chatsCount" INTEGER NOT NULL DEFAULT 0,
    "relationshipType" TEXT NOT NULL DEFAULT 'new',
    "preferences" JSONB,
    "communicationStyle" JSONB,
    "keyFacts" JSONB,
    "lastOrderId" TEXT,
    "lastOrderDate" TIMESTAMP(3),
    "trustScore" INTEGER NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_memories" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "chatRoomId" TEXT,
    "orderId" TEXT,
    "memoryType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceMessageId" TEXT,
    "sourceText" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_learning_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "globalPreferences" JSONB,
    "communicationStyle" JSONB,
    "behaviorPatterns" JSONB,
    "suggestionStats" JSONB,
    "lastLearnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_learning_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_learning_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confectionerId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "extractedFacts" JSONB,
    "memoriesCreated" INTEGER NOT NULL DEFAULT 0,
    "userFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_learning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_city_idx" ON "users"("city");

-- CreateIndex
CREATE INDEX "users_isBlocked_idx" ON "users"("isBlocked");

-- CreateIndex
CREATE INDEX "loyalty_transactions_userId_idx" ON "loyalty_transactions"("userId");

-- CreateIndex
CREATE INDEX "loyalty_transactions_type_idx" ON "loyalty_transactions"("type");

-- CreateIndex
CREATE INDEX "loyalty_transactions_expiresAt_idx" ON "loyalty_transactions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "badges_code_key" ON "badges"("code");

-- CreateIndex
CREATE INDEX "badges_category_idx" ON "badges"("category");

-- CreateIndex
CREATE INDEX "badges_active_idx" ON "badges"("active");

-- CreateIndex
CREATE INDEX "badges_rarity_idx" ON "badges"("rarity");

-- CreateIndex
CREATE INDEX "user_badges_userId_idx" ON "user_badges"("userId");

-- CreateIndex
CREATE INDEX "user_badges_badgeId_idx" ON "user_badges"("badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeId_key" ON "user_badges"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "challenges_code_key" ON "challenges"("code");

-- CreateIndex
CREATE INDEX "challenges_active_idx" ON "challenges"("active");

-- CreateIndex
CREATE INDEX "challenges_endsAt_idx" ON "challenges"("endsAt");

-- CreateIndex
CREATE INDEX "user_challenges_userId_idx" ON "user_challenges"("userId");

-- CreateIndex
CREATE INDEX "user_challenges_challengeId_idx" ON "user_challenges"("challengeId");

-- CreateIndex
CREATE INDEX "user_challenges_completed_idx" ON "user_challenges"("completed");

-- CreateIndex
CREATE UNIQUE INDEX "user_challenges_userId_challengeId_key" ON "user_challenges"("userId", "challengeId");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "notifications_template_idx" ON "notifications"("template");

-- CreateIndex
CREATE INDEX "notifications_scheduledFor_idx" ON "notifications"("scheduledFor");

-- CreateIndex
CREATE INDEX "notifications_channel_status_idx" ON "notifications"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "confectioners_userId_key" ON "confectioners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "confectioners_slug_key" ON "confectioners"("slug");

-- CreateIndex
CREATE INDEX "confectioners_city_idx" ON "confectioners"("city");

-- CreateIndex
CREATE INDEX "confectioners_verified_idx" ON "confectioners"("verified");

-- CreateIndex
CREATE INDEX "confectioners_verificationStatus_idx" ON "confectioners"("verificationStatus");

-- CreateIndex
CREATE INDEX "confectioners_trustLevel_idx" ON "confectioners"("trustLevel");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_confectionerId_idx" ON "products"("confectionerId");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_isPopular_idx" ON "products"("isPopular");

-- CreateIndex
CREATE INDEX "products_isNew_idx" ON "products"("isNew");

-- CreateIndex
CREATE INDEX "products_isHit_idx" ON "products"("isHit");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_promoCodeId_key" ON "orders"("promoCodeId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_confectionerId_idx" ON "orders"("confectionerId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_paymentStatus_idx" ON "orders"("paymentStatus");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "cart_items_userId_idx" ON "cart_items"("userId");

-- CreateIndex
CREATE INDEX "reviews_productId_idx" ON "reviews"("productId");

-- CreateIndex
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");

-- CreateIndex
CREATE INDEX "video_reviews_productId_idx" ON "video_reviews"("productId");

-- CreateIndex
CREATE INDEX "promotions_confectionerId_idx" ON "promotions"("confectionerId");

-- CreateIndex
CREATE INDEX "promotions_status_idx" ON "promotions"("status");

-- CreateIndex
CREATE INDEX "recipes_confectionerId_idx" ON "recipes"("confectionerId");

-- CreateIndex
CREATE INDEX "chat_messages_roomId_idx" ON "chat_messages"("roomId");

-- CreateIndex
CREATE INDEX "chat_messages_senderId_idx" ON "chat_messages"("senderId");

-- CreateIndex
CREATE INDEX "chat_messages_isBot_idx" ON "chat_messages"("isBot");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_userId_key" ON "referrals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referralCode_key" ON "referrals"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "gift_certificates_code_key" ON "gift_certificates"("code");

-- CreateIndex
CREATE INDEX "gift_certificates_fromUserId_idx" ON "gift_certificates"("fromUserId");

-- CreateIndex
CREATE INDEX "user_holidays_userId_idx" ON "user_holidays"("userId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "blacklist_scope_value_idx" ON "blacklist"("scope", "value");

-- CreateIndex
CREATE INDEX "blacklist_status_idx" ON "blacklist"("status");

-- CreateIndex
CREATE UNIQUE INDEX "semaphores_value_key" ON "semaphores"("value");

-- CreateIndex
CREATE INDEX "semaphores_type_idx" ON "semaphores"("type");

-- CreateIndex
CREATE INDEX "inventory_items_confectionerId_idx" ON "inventory_items"("confectionerId");

-- CreateIndex
CREATE INDEX "stock_movements_itemId_idx" ON "stock_movements"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages"("slug");

-- CreateIndex
CREATE INDEX "cms_blocks_pageId_idx" ON "cms_blocks"("pageId");

-- CreateIndex
CREATE INDEX "banners_position_isActive_idx" ON "banners"("position", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_key_key" ON "site_settings"("key");

-- CreateIndex
CREATE INDEX "site_settings_category_idx" ON "site_settings"("category");

-- CreateIndex
CREATE INDEX "nav_menu_items_parentId_idx" ON "nav_menu_items"("parentId");

-- CreateIndex
CREATE INDEX "organization_verifications_userId_idx" ON "organization_verifications"("userId");

-- CreateIndex
CREATE INDEX "organization_verifications_confectionerId_idx" ON "organization_verifications"("confectionerId");

-- CreateIndex
CREATE INDEX "organization_verifications_inn_idx" ON "organization_verifications"("inn");

-- CreateIndex
CREATE INDEX "organization_verifications_status_idx" ON "organization_verifications"("status");

-- CreateIndex
CREATE INDEX "organization_verifications_createdAt_idx" ON "organization_verifications"("createdAt");

-- CreateIndex
CREATE INDEX "maintenance_logs_type_idx" ON "maintenance_logs"("type");

-- CreateIndex
CREATE INDEX "maintenance_logs_status_idx" ON "maintenance_logs"("status");

-- CreateIndex
CREATE INDEX "maintenance_logs_createdAt_idx" ON "maintenance_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fillings_name_key" ON "fillings"("name");

-- CreateIndex
CREATE UNIQUE INDEX "fillings_slug_key" ON "fillings"("slug");

-- CreateIndex
CREATE INDEX "fillings_status_idx" ON "fillings"("status");

-- CreateIndex
CREATE INDEX "fillings_category_idx" ON "fillings"("category");

-- CreateIndex
CREATE INDEX "fillings_slug_idx" ON "fillings"("slug");

-- CreateIndex
CREATE INDEX "product_slices_productId_idx" ON "product_slices"("productId");

-- CreateIndex
CREATE INDEX "product_slices_fillingName_idx" ON "product_slices"("fillingName");

-- CreateIndex
CREATE INDEX "live_streams_confectionerId_idx" ON "live_streams"("confectionerId");

-- CreateIndex
CREATE INDEX "live_streams_status_idx" ON "live_streams"("status");

-- CreateIndex
CREATE INDEX "live_streams_scheduledAt_idx" ON "live_streams"("scheduledAt");

-- CreateIndex
CREATE INDEX "live_stream_viewers_streamId_idx" ON "live_stream_viewers"("streamId");

-- CreateIndex
CREATE INDEX "live_stream_viewers_userId_idx" ON "live_stream_viewers"("userId");

-- CreateIndex
CREATE INDEX "live_stream_orders_streamId_idx" ON "live_stream_orders"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "live_stream_orders_streamId_orderId_key" ON "live_stream_orders"("streamId", "orderId");

-- CreateIndex
CREATE INDEX "live_stream_messages_streamId_idx" ON "live_stream_messages"("streamId");

-- CreateIndex
CREATE INDEX "live_stream_messages_userId_idx" ON "live_stream_messages"("userId");

-- CreateIndex
CREATE INDEX "live_stream_messages_createdAt_idx" ON "live_stream_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_code_idx" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_confectionerId_idx" ON "promo_codes"("confectionerId");

-- CreateIndex
CREATE INDEX "promo_codes_isActive_idx" ON "promo_codes"("isActive");

-- CreateIndex
CREATE INDEX "two_factor_challenges_userId_idx" ON "two_factor_challenges"("userId");

-- CreateIndex
CREATE INDEX "two_factor_challenges_expiresAt_idx" ON "two_factor_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "order_fraud_logs_ipHash_idx" ON "order_fraud_logs"("ipHash");

-- CreateIndex
CREATE INDEX "order_fraud_logs_userId_idx" ON "order_fraud_logs"("userId");

-- CreateIndex
CREATE INDEX "order_fraud_logs_createdAt_idx" ON "order_fraud_logs"("createdAt");

-- CreateIndex
CREATE INDEX "order_fraud_logs_action_idx" ON "order_fraud_logs"("action");

-- CreateIndex
CREATE INDEX "operator_escalations_status_idx" ON "operator_escalations"("status");

-- CreateIndex
CREATE INDEX "operator_escalations_assignedTo_idx" ON "operator_escalations"("assignedTo");

-- CreateIndex
CREATE INDEX "operator_escalations_createdAt_idx" ON "operator_escalations"("createdAt");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_revokedAt_idx" ON "refresh_tokens"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "courier_profiles_userId_key" ON "courier_profiles"("userId");

-- CreateIndex
CREATE INDEX "courier_profiles_region_idx" ON "courier_profiles"("region");

-- CreateIndex
CREATE INDEX "courier_profiles_isActive_idx" ON "courier_profiles"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_userId_key" ON "supplier_profiles"("userId");

-- CreateIndex
CREATE INDEX "supplier_profiles_inn_idx" ON "supplier_profiles"("inn");

-- CreateIndex
CREATE INDEX "supplier_profiles_isActive_idx" ON "supplier_profiles"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_userId_key" ON "customer_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "blogger_profiles_userId_key" ON "blogger_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "blogger_profiles_referralCode_key" ON "blogger_profiles"("referralCode");

-- CreateIndex
CREATE INDEX "blogger_profiles_referralCode_idx" ON "blogger_profiles"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "taster_profiles_userId_key" ON "taster_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "franchisee_profiles_userId_key" ON "franchisee_profiles"("userId");

-- CreateIndex
CREATE INDEX "franchisee_profiles_region_idx" ON "franchisee_profiles"("region");

-- CreateIndex
CREATE INDEX "franchisee_profiles_status_idx" ON "franchisee_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "nutritionist_profiles_userId_key" ON "nutritionist_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_client_profiles_userId_key" ON "corporate_client_profiles"("userId");

-- CreateIndex
CREATE INDEX "corporate_client_profiles_inn_idx" ON "corporate_client_profiles"("inn");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspector_profiles_userId_key" ON "quality_inspector_profiles"("userId");

-- CreateIndex
CREATE INDEX "quality_inspector_profiles_region_idx" ON "quality_inspector_profiles"("region");

-- CreateIndex
CREATE UNIQUE INDEX "certification_agent_profiles_userId_key" ON "certification_agent_profiles"("userId");

-- CreateIndex
CREATE INDEX "certification_agent_profiles_license_idx" ON "certification_agent_profiles"("license");

-- CreateIndex
CREATE UNIQUE INDEX "copywriter_profiles_userId_key" ON "copywriter_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "moderator_profiles_userId_key" ON "moderator_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "event_organizer_profiles_userId_key" ON "event_organizer_profiles"("userId");

-- CreateIndex
CREATE INDEX "event_organizer_profiles_inn_idx" ON "event_organizer_profiles"("inn");

-- CreateIndex
CREATE UNIQUE INDEX "food_service_profiles_userId_key" ON "food_service_profiles"("userId");

-- CreateIndex
CREATE INDEX "food_service_profiles_venueType_idx" ON "food_service_profiles"("venueType");

-- CreateIndex
CREATE INDEX "food_service_profiles_inn_idx" ON "food_service_profiles"("inn");

-- CreateIndex
CREATE UNIQUE INDEX "studio_profiles_userId_key" ON "studio_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_point_profiles_userId_key" ON "pickup_point_profiles"("userId");

-- CreateIndex
CREATE INDEX "pickup_point_profiles_storageType_idx" ON "pickup_point_profiles"("storageType");

-- CreateIndex
CREATE INDEX "pickup_point_profiles_isActive_idx" ON "pickup_point_profiles"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "wholesaler_profiles_userId_key" ON "wholesaler_profiles"("userId");

-- CreateIndex
CREATE INDEX "wholesaler_profiles_inn_idx" ON "wholesaler_profiles"("inn");

-- CreateIndex
CREATE INDEX "wholesaler_profiles_isActive_idx" ON "wholesaler_profiles"("isActive");

-- CreateIndex
CREATE INDEX "message_reactions_messageId_idx" ON "message_reactions"("messageId");

-- CreateIndex
CREATE INDEX "message_reactions_userId_idx" ON "message_reactions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_messageId_userId_emoji_key" ON "message_reactions"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "message_attachments_messageId_idx" ON "message_attachments"("messageId");

-- CreateIndex
CREATE INDEX "message_attachments_type_idx" ON "message_attachments"("type");

-- CreateIndex
CREATE INDEX "message_reports_messageId_idx" ON "message_reports"("messageId");

-- CreateIndex
CREATE INDEX "message_reports_reporterId_idx" ON "message_reports"("reporterId");

-- CreateIndex
CREATE INDEX "message_reports_status_idx" ON "message_reports"("status");

-- CreateIndex
CREATE INDEX "canned_responses_category_idx" ON "canned_responses"("category");

-- CreateIndex
CREATE INDEX "canned_responses_isActive_idx" ON "canned_responses"("isActive");

-- CreateIndex
CREATE INDEX "chat_notification_settings_userId_idx" ON "chat_notification_settings"("userId");

-- CreateIndex
CREATE INDEX "chat_notification_settings_roomId_idx" ON "chat_notification_settings"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_notification_settings_userId_roomId_key" ON "chat_notification_settings"("userId", "roomId");

-- CreateIndex
CREATE INDEX "channel_posts_confectionerId_idx" ON "channel_posts"("confectionerId");

-- CreateIndex
CREATE INDEX "channel_posts_publishedAt_idx" ON "channel_posts"("publishedAt");

-- CreateIndex
CREATE INDEX "channel_posts_isPinned_idx" ON "channel_posts"("isPinned");

-- CreateIndex
CREATE INDEX "channel_stories_confectionerId_idx" ON "channel_stories"("confectionerId");

-- CreateIndex
CREATE INDEX "channel_stories_expiresAt_idx" ON "channel_stories"("expiresAt");

-- CreateIndex
CREATE INDEX "channel_stories_productId_idx" ON "channel_stories"("productId");

-- CreateIndex
CREATE INDEX "channel_stories_type_idx" ON "channel_stories"("type");

-- CreateIndex
CREATE INDEX "story_likes_storyId_idx" ON "story_likes"("storyId");

-- CreateIndex
CREATE INDEX "story_likes_userId_idx" ON "story_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "story_likes_storyId_userId_key" ON "story_likes"("storyId", "userId");

-- CreateIndex
CREATE INDEX "story_replies_storyId_idx" ON "story_replies"("storyId");

-- CreateIndex
CREATE INDEX "story_replies_userId_idx" ON "story_replies"("userId");

-- CreateIndex
CREATE INDEX "channel_followers_confectionerId_idx" ON "channel_followers"("confectionerId");

-- CreateIndex
CREATE INDEX "channel_followers_userId_idx" ON "channel_followers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_followers_confectionerId_userId_key" ON "channel_followers"("confectionerId", "userId");

-- CreateIndex
CREATE INDEX "channel_comments_postId_idx" ON "channel_comments"("postId");

-- CreateIndex
CREATE INDEX "channel_comments_userId_idx" ON "channel_comments"("userId");

-- CreateIndex
CREATE INDEX "channel_likes_postId_idx" ON "channel_likes"("postId");

-- CreateIndex
CREATE INDEX "channel_likes_userId_idx" ON "channel_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_likes_postId_userId_key" ON "channel_likes"("postId", "userId");

-- CreateIndex
CREATE INDEX "team_members_teamId_idx" ON "team_members"("teamId");

-- CreateIndex
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE INDEX "team_tasks_teamId_idx" ON "team_tasks"("teamId");

-- CreateIndex
CREATE INDEX "team_tasks_assigneeId_idx" ON "team_tasks"("assigneeId");

-- CreateIndex
CREATE INDEX "team_tasks_status_idx" ON "team_tasks"("status");

-- CreateIndex
CREATE INDEX "team_events_teamId_idx" ON "team_events"("teamId");

-- CreateIndex
CREATE INDEX "team_events_date_idx" ON "team_events"("date");

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_key" ON "team_invitations"("token");

-- CreateIndex
CREATE INDEX "team_invitations_teamId_idx" ON "team_invitations"("teamId");

-- CreateIndex
CREATE INDEX "team_invitations_email_idx" ON "team_invitations"("email");

-- CreateIndex
CREATE INDEX "team_invitations_status_idx" ON "team_invitations"("status");

-- CreateIndex
CREATE INDEX "team_activity_logs_teamId_idx" ON "team_activity_logs"("teamId");

-- CreateIndex
CREATE INDEX "team_activity_logs_userId_idx" ON "team_activity_logs"("userId");

-- CreateIndex
CREATE INDEX "team_activity_logs_createdAt_idx" ON "team_activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "confectioner_transactions_confectionerId_idx" ON "confectioner_transactions"("confectionerId");

-- CreateIndex
CREATE INDEX "confectioner_transactions_type_idx" ON "confectioner_transactions"("type");

-- CreateIndex
CREATE INDEX "confectioner_transactions_createdAt_idx" ON "confectioner_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "payout_requests_confectionerId_idx" ON "payout_requests"("confectionerId");

-- CreateIndex
CREATE INDEX "payout_requests_status_idx" ON "payout_requests"("status");

-- CreateIndex
CREATE INDEX "business_expenses_confectionerId_idx" ON "business_expenses"("confectionerId");

-- CreateIndex
CREATE INDEX "business_expenses_category_idx" ON "business_expenses"("category");

-- CreateIndex
CREATE INDEX "business_expenses_date_idx" ON "business_expenses"("date");

-- CreateIndex
CREATE INDEX "insurance_contributions_confectionerId_idx" ON "insurance_contributions"("confectionerId");

-- CreateIndex
CREATE INDEX "insurance_contributions_period_idx" ON "insurance_contributions"("period");

-- CreateIndex
CREATE INDEX "insurance_contributions_status_idx" ON "insurance_contributions"("status");

-- CreateIndex
CREATE INDEX "tax_reports_confectionerId_idx" ON "tax_reports"("confectionerId");

-- CreateIndex
CREATE INDEX "tax_reports_period_idx" ON "tax_reports"("period");

-- CreateIndex
CREATE INDEX "tax_reports_status_idx" ON "tax_reports"("status");

-- CreateIndex
CREATE INDEX "financial_audit_logs_userId_idx" ON "financial_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "financial_audit_logs_action_idx" ON "financial_audit_logs"("action");

-- CreateIndex
CREATE INDEX "financial_audit_logs_createdAt_idx" ON "financial_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "order_tracking_orderId_idx" ON "order_tracking"("orderId");

-- CreateIndex
CREATE INDEX "order_tracking_courierId_idx" ON "order_tracking"("courierId");

-- CreateIndex
CREATE INDEX "order_tracking_timestamp_idx" ON "order_tracking"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "courier_locations_courierId_key" ON "courier_locations"("courierId");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "order_negotiations_orderId_idx" ON "order_negotiations"("orderId");

-- CreateIndex
CREATE INDEX "order_negotiations_confectionerId_idx" ON "order_negotiations"("confectionerId");

-- CreateIndex
CREATE INDEX "order_negotiations_status_idx" ON "order_negotiations"("status");

-- CreateIndex
CREATE INDEX "constructor_drafts_userId_idx" ON "constructor_drafts"("userId");

-- CreateIndex
CREATE INDEX "constructor_drafts_updatedAt_idx" ON "constructor_drafts"("updatedAt");

-- CreateIndex
CREATE INDEX "price_inquiries_userId_idx" ON "price_inquiries"("userId");

-- CreateIndex
CREATE INDEX "price_inquiries_draftId_idx" ON "price_inquiries"("draftId");

-- CreateIndex
CREATE INDEX "price_inquiries_status_idx" ON "price_inquiries"("status");

-- CreateIndex
CREATE INDEX "wholesale_prices_productId_idx" ON "wholesale_prices"("productId");

-- CreateIndex
CREATE INDEX "wholesale_prices_isActive_idx" ON "wholesale_prices"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "wholesale_prices_productId_minQuantity_key" ON "wholesale_prices"("productId", "minQuantity");

-- CreateIndex
CREATE INDEX "recurring_orders_customerId_idx" ON "recurring_orders"("customerId");

-- CreateIndex
CREATE INDEX "recurring_orders_supplierId_idx" ON "recurring_orders"("supplierId");

-- CreateIndex
CREATE INDEX "recurring_orders_nextRunAt_idx" ON "recurring_orders"("nextRunAt");

-- CreateIndex
CREATE INDEX "recurring_orders_status_idx" ON "recurring_orders"("status");

-- CreateIndex
CREATE INDEX "cake_subscriptions_customerId_idx" ON "cake_subscriptions"("customerId");

-- CreateIndex
CREATE INDEX "cake_subscriptions_confectionerId_idx" ON "cake_subscriptions"("confectionerId");

-- CreateIndex
CREATE INDEX "cake_subscriptions_status_idx" ON "cake_subscriptions"("status");

-- CreateIndex
CREATE INDEX "cake_subscriptions_nextDeliveryAt_idx" ON "cake_subscriptions"("nextDeliveryAt");

-- CreateIndex
CREATE UNIQUE INDEX "confectioner_ateliers_confectionerId_key" ON "confectioner_ateliers"("confectionerId");

-- CreateIndex
CREATE INDEX "confectioner_lessons_confectionerId_idx" ON "confectioner_lessons"("confectionerId");

-- CreateIndex
CREATE INDEX "confectioner_lessons_type_idx" ON "confectioner_lessons"("type");

-- CreateIndex
CREATE INDEX "confectioner_lessons_status_idx" ON "confectioner_lessons"("status");

-- CreateIndex
CREATE INDEX "confectioner_lessons_difficultyLevel_idx" ON "confectioner_lessons"("difficultyLevel");

-- CreateIndex
CREATE INDEX "confectioner_lessons_createdAt_idx" ON "confectioner_lessons"("createdAt");

-- CreateIndex
CREATE INDEX "lesson_enrollments_lessonId_idx" ON "lesson_enrollments"("lessonId");

-- CreateIndex
CREATE INDEX "lesson_enrollments_userId_idx" ON "lesson_enrollments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_enrollments_lessonId_userId_key" ON "lesson_enrollments"("lessonId", "userId");

-- CreateIndex
CREATE INDEX "holiday_reminders_userId_idx" ON "holiday_reminders"("userId");

-- CreateIndex
CREATE INDEX "holiday_reminders_month_day_idx" ON "holiday_reminders"("month", "day");

-- CreateIndex
CREATE INDEX "holiday_reminders_active_idx" ON "holiday_reminders"("active");

-- CreateIndex
CREATE INDEX "video_feed_items_confectionerId_idx" ON "video_feed_items"("confectionerId");

-- CreateIndex
CREATE INDEX "video_feed_items_status_idx" ON "video_feed_items"("status");

-- CreateIndex
CREATE INDEX "video_feed_items_createdAt_idx" ON "video_feed_items"("createdAt");

-- CreateIndex
CREATE INDEX "video_feed_items_rating_idx" ON "video_feed_items"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "cms_sections_slug_key" ON "cms_sections"("slug");

-- CreateIndex
CREATE INDEX "cms_sections_visible_idx" ON "cms_sections"("visible");

-- CreateIndex
CREATE INDEX "cms_section_blocks_sectionId_idx" ON "cms_section_blocks"("sectionId");

-- CreateIndex
CREATE INDEX "cms_section_blocks_order_idx" ON "cms_section_blocks"("order");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_url_key" ON "media_files"("url");

-- CreateIndex
CREATE INDEX "media_files_uploadedBy_idx" ON "media_files"("uploadedBy");

-- CreateIndex
CREATE INDEX "media_files_type_idx" ON "media_files"("type");

-- CreateIndex
CREATE INDEX "image_processing_queue_mediaFileId_idx" ON "image_processing_queue"("mediaFileId");

-- CreateIndex
CREATE INDEX "image_processing_queue_status_idx" ON "image_processing_queue"("status");

-- CreateIndex
CREATE INDEX "action_logs_userId_idx" ON "action_logs"("userId");

-- CreateIndex
CREATE INDEX "action_logs_action_idx" ON "action_logs"("action");

-- CreateIndex
CREATE INDEX "action_logs_entity_entityId_idx" ON "action_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "action_logs_createdAt_idx" ON "action_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "promo_campaigns_code_key" ON "promo_campaigns"("code");

-- CreateIndex
CREATE INDEX "promo_campaigns_code_idx" ON "promo_campaigns"("code");

-- CreateIndex
CREATE INDEX "promo_campaigns_isActive_idx" ON "promo_campaigns"("isActive");

-- CreateIndex
CREATE INDEX "promo_campaigns_startDate_endDate_idx" ON "promo_campaigns"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "promo_code_usages_promoCodeId_idx" ON "promo_code_usages"("promoCodeId");

-- CreateIndex
CREATE INDEX "promo_code_usages_userId_idx" ON "promo_code_usages"("userId");

-- CreateIndex
CREATE INDEX "promo_code_usages_orderId_idx" ON "promo_code_usages"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_usages_promoCodeId_userId_orderId_key" ON "promo_code_usages"("promoCodeId", "userId", "orderId");

-- CreateIndex
CREATE INDEX "wishlist_items_userId_idx" ON "wishlist_items"("userId");

-- CreateIndex
CREATE INDEX "wishlist_items_productId_idx" ON "wishlist_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_userId_productId_key" ON "wishlist_items"("userId", "productId");

-- CreateIndex
CREATE INDEX "recipe_acceptances_recipeId_idx" ON "recipe_acceptances"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_acceptances_confectionerId_idx" ON "recipe_acceptances"("confectionerId");

-- CreateIndex
CREATE INDEX "recipe_acceptances_status_idx" ON "recipe_acceptances"("status");

-- CreateIndex
CREATE INDEX "simplex_contacts_userId_idx" ON "simplex_contacts"("userId");

-- CreateIndex
CREATE INDEX "simplex_contacts_profileType_idx" ON "simplex_contacts"("profileType");

-- CreateIndex
CREATE INDEX "simplex_contacts_active_idx" ON "simplex_contacts"("active");

-- CreateIndex
CREATE INDEX "simplex_messages_simplexContactId_idx" ON "simplex_messages"("simplexContactId");

-- CreateIndex
CREATE INDEX "simplex_messages_direction_idx" ON "simplex_messages"("direction");

-- CreateIndex
CREATE INDEX "simplex_messages_receivedAt_idx" ON "simplex_messages"("receivedAt");

-- CreateIndex
CREATE INDEX "simplex_messages_orderId_idx" ON "simplex_messages"("orderId");

-- CreateIndex
CREATE INDEX "relationship_contexts_customerId_idx" ON "relationship_contexts"("customerId");

-- CreateIndex
CREATE INDEX "relationship_contexts_confectionerId_idx" ON "relationship_contexts"("confectionerId");

-- CreateIndex
CREATE INDEX "relationship_contexts_relationshipType_idx" ON "relationship_contexts"("relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_contexts_customerId_confectionerId_key" ON "relationship_contexts"("customerId", "confectionerId");

-- CreateIndex
CREATE INDEX "conversation_memories_customerId_idx" ON "conversation_memories"("customerId");

-- CreateIndex
CREATE INDEX "conversation_memories_confectionerId_idx" ON "conversation_memories"("confectionerId");

-- CreateIndex
CREATE INDEX "conversation_memories_customerId_confectionerId_idx" ON "conversation_memories"("customerId", "confectionerId");

-- CreateIndex
CREATE INDEX "conversation_memories_memoryType_idx" ON "conversation_memories"("memoryType");

-- CreateIndex
CREATE INDEX "conversation_memories_isGlobal_idx" ON "conversation_memories"("isGlobal");

-- CreateIndex
CREATE UNIQUE INDEX "ai_learning_profiles_userId_key" ON "ai_learning_profiles"("userId");

-- CreateIndex
CREATE INDEX "ai_learning_profiles_userId_idx" ON "ai_learning_profiles"("userId");

-- CreateIndex
CREATE INDEX "ai_learning_logs_userId_idx" ON "ai_learning_logs"("userId");

-- CreateIndex
CREATE INDEX "ai_learning_logs_confectionerId_idx" ON "ai_learning_logs"("confectionerId");

-- CreateIndex
CREATE INDEX "ai_learning_logs_sourceType_idx" ON "ai_learning_logs"("sourceType");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_challenges" ADD CONSTRAINT "user_challenges_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confectioners" ADD CONSTRAINT "confectioners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_confectionerId_fkey" FOREIGN KEY ("confectionerId") REFERENCES "confectioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_confectionerId_fkey" FOREIGN KEY ("confectionerId") REFERENCES "confectioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_reviews" ADD CONSTRAINT "video_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_reviews" ADD CONSTRAINT "video_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_confectionerId_fkey" FOREIGN KEY ("confectionerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_confectionerId_fkey" FOREIGN KEY ("confectionerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_certificates" ADD CONSTRAINT "gift_certificates_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_certificates" ADD CONSTRAINT "gift_certificates_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_holidays" ADD CONSTRAINT "user_holidays_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_blocks" ADD CONSTRAINT "cms_blocks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "cms_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verifications" ADD CONSTRAINT "organization_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verifications" ADD CONSTRAINT "organization_verifications_confectionerId_fkey" FOREIGN KEY ("confectionerId") REFERENCES "confectioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simplex_contacts" ADD CONSTRAINT "simplex_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simplex_messages" ADD CONSTRAINT "simplex_messages_simplexContactId_fkey" FOREIGN KEY ("simplexContactId") REFERENCES "simplex_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

