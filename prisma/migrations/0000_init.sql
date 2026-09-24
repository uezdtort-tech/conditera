-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'CONFECTIONER', 'ADMIN', 'SUPER_ADMIN', 'COURIER', 'SUPPLIER', 'VENUE_OWNER', 'ANIMATOR_AGENCY', 'RECREATION_CENTER', 'KIDS_CLUB');

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
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'waiting_for_capture', 'succeeded', 'cancelled', 'refunded');

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
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confectioners" ADD CONSTRAINT "confectioners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_confectionerId_fkey" FOREIGN KEY ("confectionerId") REFERENCES "confectioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

