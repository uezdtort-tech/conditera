-- 0017_sync_missing_tables.sql
-- Синхронизация: перенос недостающих таблиц из Prisma migration в Supabase.
-- Добавлено таблиц: 88

CREATE TABLE IF NOT EXISTS "users" (
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

CREATE TABLE IF NOT EXISTS "confectioners" (
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

CREATE TABLE IF NOT EXISTS "reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "video_reviews" (
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

CREATE TABLE IF NOT EXISTS "promotions" (
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

CREATE TABLE IF NOT EXISTS "chat_rooms" (
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

CREATE TABLE IF NOT EXISTS "referrals" (
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

CREATE TABLE IF NOT EXISTS "user_holidays" (
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

CREATE TABLE IF NOT EXISTS "blacklist" (
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

CREATE TABLE IF NOT EXISTS "semaphores" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semaphores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cms_blocks" (
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

CREATE TABLE IF NOT EXISTS "banners" (
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

CREATE TABLE IF NOT EXISTS "site_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "nav_menu_items" (
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

CREATE TABLE IF NOT EXISTS "maintenance_logs" (
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

CREATE TABLE IF NOT EXISTS "product_slices" (
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

CREATE TABLE IF NOT EXISTS "live_streams" (
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

CREATE TABLE IF NOT EXISTS "live_stream_viewers" (
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

CREATE TABLE IF NOT EXISTS "live_stream_orders" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_stream_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "live_stream_messages" (
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

CREATE TABLE IF NOT EXISTS "two_factor_challenges" (
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

CREATE TABLE IF NOT EXISTS "order_fraud_logs" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "deviceFp" TEXT,
    "userId" TEXT,
    "orderId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fraud_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "accounts" (
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

CREATE TABLE IF NOT EXISTS "sessions" (
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

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "courier_profiles" (
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

CREATE TABLE IF NOT EXISTS "supplier_profiles" (
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

CREATE TABLE IF NOT EXISTS "customer_profiles" (
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

CREATE TABLE IF NOT EXISTS "blogger_profiles" (
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

CREATE TABLE IF NOT EXISTS "taster_profiles" (
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

CREATE TABLE IF NOT EXISTS "franchisee_profiles" (
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

CREATE TABLE IF NOT EXISTS "nutritionist_profiles" (
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

CREATE TABLE IF NOT EXISTS "corporate_client_profiles" (
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

CREATE TABLE IF NOT EXISTS "quality_inspector_profiles" (
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

CREATE TABLE IF NOT EXISTS "certification_agent_profiles" (
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

CREATE TABLE IF NOT EXISTS "copywriter_profiles" (
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

CREATE TABLE IF NOT EXISTS "moderator_profiles" (
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

CREATE TABLE IF NOT EXISTS "event_organizer_profiles" (
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

CREATE TABLE IF NOT EXISTS "food_service_profiles" (
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

CREATE TABLE IF NOT EXISTS "studio_profiles" (
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

CREATE TABLE IF NOT EXISTS "pickup_point_profiles" (
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

CREATE TABLE IF NOT EXISTS "wholesaler_profiles" (
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

CREATE TABLE IF NOT EXISTS "message_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "message_attachments" (
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

CREATE TABLE IF NOT EXISTS "message_reports" (
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

CREATE TABLE IF NOT EXISTS "chat_notification_settings" (
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

CREATE TABLE IF NOT EXISTS "channel_posts" (
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

CREATE TABLE IF NOT EXISTS "channel_stories" (
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

CREATE TABLE IF NOT EXISTS "story_likes" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_likes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "story_replies" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "channel_followers" (
    "id" TEXT NOT NULL,
    "confectionerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_followers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "channel_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "channel_likes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_likes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_tasks" (
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

CREATE TABLE IF NOT EXISTS "team_events" (
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

CREATE TABLE IF NOT EXISTS "team_invitations" (
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

CREATE TABLE IF NOT EXISTS "team_activity_logs" (
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

CREATE TABLE IF NOT EXISTS "confectioner_transactions" (
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

CREATE TABLE IF NOT EXISTS "business_expenses" (
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

CREATE TABLE IF NOT EXISTS "insurance_contributions" (
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

CREATE TABLE IF NOT EXISTS "tax_reports" (
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

CREATE TABLE IF NOT EXISTS "financial_audit_logs" (
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

CREATE TABLE IF NOT EXISTS "order_tracking" (
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

CREATE TABLE IF NOT EXISTS "courier_locations" (
    "id" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_negotiations" (
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

CREATE TABLE IF NOT EXISTS "constructor_drafts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constructor_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "price_inquiries" (
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

CREATE TABLE IF NOT EXISTS "wholesale_prices" (
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

CREATE TABLE IF NOT EXISTS "recurring_orders" (
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

CREATE TABLE IF NOT EXISTS "cake_subscriptions" (
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

CREATE TABLE IF NOT EXISTS "confectioner_ateliers" (
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

CREATE TABLE IF NOT EXISTS "confectioner_lessons" (
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

CREATE TABLE IF NOT EXISTS "video_feed_items" (
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

CREATE TABLE IF NOT EXISTS "cms_sections" (
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

CREATE TABLE IF NOT EXISTS "cms_section_blocks" (
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

CREATE TABLE IF NOT EXISTS "media_files" (
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

CREATE TABLE IF NOT EXISTS "image_processing_queue" (
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

CREATE TABLE IF NOT EXISTS "action_logs" (
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

CREATE TABLE IF NOT EXISTS "audit_logs" (
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

CREATE TABLE IF NOT EXISTS "promo_campaigns" (
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

CREATE TABLE IF NOT EXISTS "wishlist_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "simplex_contacts" (
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

CREATE TABLE IF NOT EXISTS "simplex_messages" (
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

CREATE TABLE IF NOT EXISTS "relationship_contexts" (
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

CREATE TABLE IF NOT EXISTS "conversation_memories" (
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

CREATE TABLE IF NOT EXISTS "ai_learning_profiles" (
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

CREATE TABLE IF NOT EXISTS "ai_learning_logs" (
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

-- ===== Индексы для недостающих таблиц =====
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_city_idx" ON "users"("city");
CREATE INDEX IF NOT EXISTS "users_isBlocked_idx" ON "users"("isBlocked");
CREATE UNIQUE INDEX IF NOT EXISTS "confectioners_userId_key" ON "confectioners"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "confectioners_slug_key" ON "confectioners"("slug");
CREATE INDEX IF NOT EXISTS "confectioners_city_idx" ON "confectioners"("city");
CREATE INDEX IF NOT EXISTS "confectioners_verified_idx" ON "confectioners"("verified");
CREATE INDEX IF NOT EXISTS "confectioners_verificationStatus_idx" ON "confectioners"("verificationStatus");
CREATE INDEX IF NOT EXISTS "confectioners_trustLevel_idx" ON "confectioners"("trustLevel");
CREATE INDEX IF NOT EXISTS "reviews_productId_idx" ON "reviews"("productId");
CREATE INDEX IF NOT EXISTS "reviews_userId_idx" ON "reviews"("userId");
CREATE INDEX IF NOT EXISTS "video_reviews_productId_idx" ON "video_reviews"("productId");
CREATE INDEX IF NOT EXISTS "promotions_confectionerId_idx" ON "promotions"("confectionerId");
CREATE INDEX IF NOT EXISTS "promotions_status_idx" ON "promotions"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_userId_key" ON "referrals"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referralCode_key" ON "referrals"("referralCode");
CREATE INDEX IF NOT EXISTS "user_holidays_userId_idx" ON "user_holidays"("userId");
CREATE INDEX IF NOT EXISTS "blacklist_scope_value_idx" ON "blacklist"("scope", "value");
CREATE INDEX IF NOT EXISTS "blacklist_status_idx" ON "blacklist"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "semaphores_value_key" ON "semaphores"("value");
CREATE INDEX IF NOT EXISTS "semaphores_type_idx" ON "semaphores"("type");
CREATE INDEX IF NOT EXISTS "cms_blocks_pageId_idx" ON "cms_blocks"("pageId");
CREATE INDEX IF NOT EXISTS "banners_position_isActive_idx" ON "banners"("position", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "site_settings_key_key" ON "site_settings"("key");
CREATE INDEX IF NOT EXISTS "site_settings_category_idx" ON "site_settings"("category");
CREATE INDEX IF NOT EXISTS "nav_menu_items_parentId_idx" ON "nav_menu_items"("parentId");
CREATE INDEX IF NOT EXISTS "maintenance_logs_type_idx" ON "maintenance_logs"("type");
CREATE INDEX IF NOT EXISTS "maintenance_logs_status_idx" ON "maintenance_logs"("status");
CREATE INDEX IF NOT EXISTS "maintenance_logs_createdAt_idx" ON "maintenance_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "product_slices_productId_idx" ON "product_slices"("productId");
CREATE INDEX IF NOT EXISTS "product_slices_fillingName_idx" ON "product_slices"("fillingName");
CREATE INDEX IF NOT EXISTS "live_streams_confectionerId_idx" ON "live_streams"("confectionerId");
CREATE INDEX IF NOT EXISTS "live_streams_status_idx" ON "live_streams"("status");
CREATE INDEX IF NOT EXISTS "live_streams_scheduledAt_idx" ON "live_streams"("scheduledAt");
CREATE INDEX IF NOT EXISTS "live_stream_viewers_streamId_idx" ON "live_stream_viewers"("streamId");
CREATE INDEX IF NOT EXISTS "live_stream_viewers_userId_idx" ON "live_stream_viewers"("userId");
CREATE INDEX IF NOT EXISTS "live_stream_orders_streamId_idx" ON "live_stream_orders"("streamId");
CREATE UNIQUE INDEX IF NOT EXISTS "live_stream_orders_streamId_orderId_key" ON "live_stream_orders"("streamId", "orderId");
CREATE INDEX IF NOT EXISTS "live_stream_messages_streamId_idx" ON "live_stream_messages"("streamId");
CREATE INDEX IF NOT EXISTS "live_stream_messages_userId_idx" ON "live_stream_messages"("userId");
CREATE INDEX IF NOT EXISTS "live_stream_messages_createdAt_idx" ON "live_stream_messages"("createdAt");
CREATE INDEX IF NOT EXISTS "two_factor_challenges_userId_idx" ON "two_factor_challenges"("userId");
CREATE INDEX IF NOT EXISTS "two_factor_challenges_expiresAt_idx" ON "two_factor_challenges"("expiresAt");
CREATE INDEX IF NOT EXISTS "order_fraud_logs_ipHash_idx" ON "order_fraud_logs"("ipHash");
CREATE INDEX IF NOT EXISTS "order_fraud_logs_userId_idx" ON "order_fraud_logs"("userId");
CREATE INDEX IF NOT EXISTS "order_fraud_logs_createdAt_idx" ON "order_fraud_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "order_fraud_logs_action_idx" ON "order_fraud_logs"("action");
CREATE INDEX IF NOT EXISTS "accounts_userId_idx" ON "accounts"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_key" ON "sessions"("token");
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX IF NOT EXISTS "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_key" ON "refresh_tokens"("token");
CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");
CREATE INDEX IF NOT EXISTS "refresh_tokens_revokedAt_idx" ON "refresh_tokens"("revokedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "courier_profiles_userId_key" ON "courier_profiles"("userId");
CREATE INDEX IF NOT EXISTS "courier_profiles_region_idx" ON "courier_profiles"("region");
CREATE INDEX IF NOT EXISTS "courier_profiles_isActive_idx" ON "courier_profiles"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_profiles_userId_key" ON "supplier_profiles"("userId");
CREATE INDEX IF NOT EXISTS "supplier_profiles_inn_idx" ON "supplier_profiles"("inn");
CREATE INDEX IF NOT EXISTS "supplier_profiles_isActive_idx" ON "supplier_profiles"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_profiles_userId_key" ON "customer_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "blogger_profiles_userId_key" ON "blogger_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "blogger_profiles_referralCode_key" ON "blogger_profiles"("referralCode");
CREATE INDEX IF NOT EXISTS "blogger_profiles_referralCode_idx" ON "blogger_profiles"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "taster_profiles_userId_key" ON "taster_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "franchisee_profiles_userId_key" ON "franchisee_profiles"("userId");
CREATE INDEX IF NOT EXISTS "franchisee_profiles_region_idx" ON "franchisee_profiles"("region");
CREATE INDEX IF NOT EXISTS "franchisee_profiles_status_idx" ON "franchisee_profiles"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "nutritionist_profiles_userId_key" ON "nutritionist_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "corporate_client_profiles_userId_key" ON "corporate_client_profiles"("userId");
CREATE INDEX IF NOT EXISTS "corporate_client_profiles_inn_idx" ON "corporate_client_profiles"("inn");
CREATE UNIQUE INDEX IF NOT EXISTS "quality_inspector_profiles_userId_key" ON "quality_inspector_profiles"("userId");
CREATE INDEX IF NOT EXISTS "quality_inspector_profiles_region_idx" ON "quality_inspector_profiles"("region");
CREATE UNIQUE INDEX IF NOT EXISTS "certification_agent_profiles_userId_key" ON "certification_agent_profiles"("userId");
CREATE INDEX IF NOT EXISTS "certification_agent_profiles_license_idx" ON "certification_agent_profiles"("license");
CREATE UNIQUE INDEX IF NOT EXISTS "copywriter_profiles_userId_key" ON "copywriter_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "moderator_profiles_userId_key" ON "moderator_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "event_organizer_profiles_userId_key" ON "event_organizer_profiles"("userId");
CREATE INDEX IF NOT EXISTS "event_organizer_profiles_inn_idx" ON "event_organizer_profiles"("inn");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_profiles_userId_key" ON "food_service_profiles"("userId");
CREATE INDEX IF NOT EXISTS "food_service_profiles_venueType_idx" ON "food_service_profiles"("venueType");
CREATE INDEX IF NOT EXISTS "food_service_profiles_inn_idx" ON "food_service_profiles"("inn");
CREATE UNIQUE INDEX IF NOT EXISTS "studio_profiles_userId_key" ON "studio_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_point_profiles_userId_key" ON "pickup_point_profiles"("userId");
CREATE INDEX IF NOT EXISTS "pickup_point_profiles_storageType_idx" ON "pickup_point_profiles"("storageType");
CREATE INDEX IF NOT EXISTS "pickup_point_profiles_isActive_idx" ON "pickup_point_profiles"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "wholesaler_profiles_userId_key" ON "wholesaler_profiles"("userId");
CREATE INDEX IF NOT EXISTS "wholesaler_profiles_inn_idx" ON "wholesaler_profiles"("inn");
CREATE INDEX IF NOT EXISTS "wholesaler_profiles_isActive_idx" ON "wholesaler_profiles"("isActive");
CREATE INDEX IF NOT EXISTS "message_reactions_messageId_idx" ON "message_reactions"("messageId");
CREATE INDEX IF NOT EXISTS "message_reactions_userId_idx" ON "message_reactions"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_messageId_userId_emoji_key" ON "message_reactions"("messageId", "userId", "emoji");
CREATE INDEX IF NOT EXISTS "message_attachments_messageId_idx" ON "message_attachments"("messageId");
CREATE INDEX IF NOT EXISTS "message_attachments_type_idx" ON "message_attachments"("type");
CREATE INDEX IF NOT EXISTS "message_reports_messageId_idx" ON "message_reports"("messageId");
CREATE INDEX IF NOT EXISTS "message_reports_reporterId_idx" ON "message_reports"("reporterId");
CREATE INDEX IF NOT EXISTS "message_reports_status_idx" ON "message_reports"("status");
CREATE INDEX IF NOT EXISTS "chat_notification_settings_userId_idx" ON "chat_notification_settings"("userId");
CREATE INDEX IF NOT EXISTS "chat_notification_settings_roomId_idx" ON "chat_notification_settings"("roomId");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_notification_settings_userId_roomId_key" ON "chat_notification_settings"("userId", "roomId");
CREATE INDEX IF NOT EXISTS "channel_posts_confectionerId_idx" ON "channel_posts"("confectionerId");
CREATE INDEX IF NOT EXISTS "channel_posts_publishedAt_idx" ON "channel_posts"("publishedAt");
CREATE INDEX IF NOT EXISTS "channel_posts_isPinned_idx" ON "channel_posts"("isPinned");
CREATE INDEX IF NOT EXISTS "channel_stories_confectionerId_idx" ON "channel_stories"("confectionerId");
CREATE INDEX IF NOT EXISTS "channel_stories_expiresAt_idx" ON "channel_stories"("expiresAt");
CREATE INDEX IF NOT EXISTS "channel_stories_productId_idx" ON "channel_stories"("productId");
CREATE INDEX IF NOT EXISTS "channel_stories_type_idx" ON "channel_stories"("type");
CREATE INDEX IF NOT EXISTS "story_likes_storyId_idx" ON "story_likes"("storyId");
CREATE INDEX IF NOT EXISTS "story_likes_userId_idx" ON "story_likes"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "story_likes_storyId_userId_key" ON "story_likes"("storyId", "userId");
CREATE INDEX IF NOT EXISTS "story_replies_storyId_idx" ON "story_replies"("storyId");
CREATE INDEX IF NOT EXISTS "story_replies_userId_idx" ON "story_replies"("userId");
CREATE INDEX IF NOT EXISTS "channel_followers_confectionerId_idx" ON "channel_followers"("confectionerId");
CREATE INDEX IF NOT EXISTS "channel_followers_userId_idx" ON "channel_followers"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "channel_followers_confectionerId_userId_key" ON "channel_followers"("confectionerId", "userId");
CREATE INDEX IF NOT EXISTS "channel_comments_postId_idx" ON "channel_comments"("postId");
CREATE INDEX IF NOT EXISTS "channel_comments_userId_idx" ON "channel_comments"("userId");
CREATE INDEX IF NOT EXISTS "channel_likes_postId_idx" ON "channel_likes"("postId");
CREATE INDEX IF NOT EXISTS "channel_likes_userId_idx" ON "channel_likes"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "channel_likes_postId_userId_key" ON "channel_likes"("postId", "userId");
CREATE INDEX IF NOT EXISTS "team_members_teamId_idx" ON "team_members"("teamId");
CREATE INDEX IF NOT EXISTS "team_members_userId_idx" ON "team_members"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "team_tasks_teamId_idx" ON "team_tasks"("teamId");
CREATE INDEX IF NOT EXISTS "team_tasks_assigneeId_idx" ON "team_tasks"("assigneeId");
CREATE INDEX IF NOT EXISTS "team_tasks_status_idx" ON "team_tasks"("status");
CREATE INDEX IF NOT EXISTS "team_events_teamId_idx" ON "team_events"("teamId");
CREATE INDEX IF NOT EXISTS "team_events_date_idx" ON "team_events"("date");
CREATE UNIQUE INDEX IF NOT EXISTS "team_invitations_token_key" ON "team_invitations"("token");
CREATE INDEX IF NOT EXISTS "team_invitations_teamId_idx" ON "team_invitations"("teamId");
CREATE INDEX IF NOT EXISTS "team_invitations_email_idx" ON "team_invitations"("email");
CREATE INDEX IF NOT EXISTS "team_invitations_status_idx" ON "team_invitations"("status");
CREATE INDEX IF NOT EXISTS "team_activity_logs_teamId_idx" ON "team_activity_logs"("teamId");
CREATE INDEX IF NOT EXISTS "team_activity_logs_userId_idx" ON "team_activity_logs"("userId");
CREATE INDEX IF NOT EXISTS "team_activity_logs_createdAt_idx" ON "team_activity_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "confectioner_transactions_confectionerId_idx" ON "confectioner_transactions"("confectionerId");
CREATE INDEX IF NOT EXISTS "confectioner_transactions_type_idx" ON "confectioner_transactions"("type");
CREATE INDEX IF NOT EXISTS "confectioner_transactions_createdAt_idx" ON "confectioner_transactions"("createdAt");
CREATE INDEX IF NOT EXISTS "business_expenses_confectionerId_idx" ON "business_expenses"("confectionerId");
CREATE INDEX IF NOT EXISTS "business_expenses_category_idx" ON "business_expenses"("category");
CREATE INDEX IF NOT EXISTS "business_expenses_date_idx" ON "business_expenses"("date");
CREATE INDEX IF NOT EXISTS "insurance_contributions_confectionerId_idx" ON "insurance_contributions"("confectionerId");
CREATE INDEX IF NOT EXISTS "insurance_contributions_period_idx" ON "insurance_contributions"("period");
CREATE INDEX IF NOT EXISTS "insurance_contributions_status_idx" ON "insurance_contributions"("status");
CREATE INDEX IF NOT EXISTS "tax_reports_confectionerId_idx" ON "tax_reports"("confectionerId");
CREATE INDEX IF NOT EXISTS "tax_reports_period_idx" ON "tax_reports"("period");
CREATE INDEX IF NOT EXISTS "tax_reports_status_idx" ON "tax_reports"("status");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_userId_idx" ON "financial_audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_action_idx" ON "financial_audit_logs"("action");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_createdAt_idx" ON "financial_audit_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "order_tracking_orderId_idx" ON "order_tracking"("orderId");
CREATE INDEX IF NOT EXISTS "order_tracking_courierId_idx" ON "order_tracking"("courierId");
CREATE INDEX IF NOT EXISTS "order_tracking_timestamp_idx" ON "order_tracking"("timestamp");
CREATE UNIQUE INDEX IF NOT EXISTS "courier_locations_courierId_key" ON "courier_locations"("courierId");
CREATE INDEX IF NOT EXISTS "order_negotiations_orderId_idx" ON "order_negotiations"("orderId");
CREATE INDEX IF NOT EXISTS "order_negotiations_confectionerId_idx" ON "order_negotiations"("confectionerId");
CREATE INDEX IF NOT EXISTS "order_negotiations_status_idx" ON "order_negotiations"("status");
CREATE INDEX IF NOT EXISTS "constructor_drafts_userId_idx" ON "constructor_drafts"("userId");
CREATE INDEX IF NOT EXISTS "constructor_drafts_updatedAt_idx" ON "constructor_drafts"("updatedAt");
CREATE INDEX IF NOT EXISTS "price_inquiries_userId_idx" ON "price_inquiries"("userId");
CREATE INDEX IF NOT EXISTS "price_inquiries_draftId_idx" ON "price_inquiries"("draftId");
CREATE INDEX IF NOT EXISTS "price_inquiries_status_idx" ON "price_inquiries"("status");
CREATE INDEX IF NOT EXISTS "wholesale_prices_productId_idx" ON "wholesale_prices"("productId");
CREATE INDEX IF NOT EXISTS "wholesale_prices_isActive_idx" ON "wholesale_prices"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "wholesale_prices_productId_minQuantity_key" ON "wholesale_prices"("productId", "minQuantity");
CREATE INDEX IF NOT EXISTS "recurring_orders_customerId_idx" ON "recurring_orders"("customerId");
CREATE INDEX IF NOT EXISTS "recurring_orders_supplierId_idx" ON "recurring_orders"("supplierId");
CREATE INDEX IF NOT EXISTS "recurring_orders_nextRunAt_idx" ON "recurring_orders"("nextRunAt");
CREATE INDEX IF NOT EXISTS "recurring_orders_status_idx" ON "recurring_orders"("status");
CREATE INDEX IF NOT EXISTS "cake_subscriptions_customerId_idx" ON "cake_subscriptions"("customerId");
CREATE INDEX IF NOT EXISTS "cake_subscriptions_confectionerId_idx" ON "cake_subscriptions"("confectionerId");
CREATE INDEX IF NOT EXISTS "cake_subscriptions_status_idx" ON "cake_subscriptions"("status");
CREATE INDEX IF NOT EXISTS "cake_subscriptions_nextDeliveryAt_idx" ON "cake_subscriptions"("nextDeliveryAt");
CREATE UNIQUE INDEX IF NOT EXISTS "confectioner_ateliers_confectionerId_key" ON "confectioner_ateliers"("confectionerId");
CREATE INDEX IF NOT EXISTS "confectioner_lessons_confectionerId_idx" ON "confectioner_lessons"("confectionerId");
CREATE INDEX IF NOT EXISTS "confectioner_lessons_type_idx" ON "confectioner_lessons"("type");
CREATE INDEX IF NOT EXISTS "confectioner_lessons_status_idx" ON "confectioner_lessons"("status");
CREATE INDEX IF NOT EXISTS "confectioner_lessons_difficultyLevel_idx" ON "confectioner_lessons"("difficultyLevel");
CREATE INDEX IF NOT EXISTS "confectioner_lessons_createdAt_idx" ON "confectioner_lessons"("createdAt");
CREATE INDEX IF NOT EXISTS "video_feed_items_confectionerId_idx" ON "video_feed_items"("confectionerId");
CREATE INDEX IF NOT EXISTS "video_feed_items_status_idx" ON "video_feed_items"("status");
CREATE INDEX IF NOT EXISTS "video_feed_items_createdAt_idx" ON "video_feed_items"("createdAt");
CREATE INDEX IF NOT EXISTS "video_feed_items_rating_idx" ON "video_feed_items"("rating");
CREATE UNIQUE INDEX IF NOT EXISTS "cms_sections_slug_key" ON "cms_sections"("slug");
CREATE INDEX IF NOT EXISTS "cms_sections_visible_idx" ON "cms_sections"("visible");
CREATE INDEX IF NOT EXISTS "cms_section_blocks_sectionId_idx" ON "cms_section_blocks"("sectionId");
CREATE INDEX IF NOT EXISTS "cms_section_blocks_order_idx" ON "cms_section_blocks"("order");
CREATE UNIQUE INDEX IF NOT EXISTS "media_files_url_key" ON "media_files"("url");
CREATE INDEX IF NOT EXISTS "media_files_uploadedBy_idx" ON "media_files"("uploadedBy");
CREATE INDEX IF NOT EXISTS "media_files_type_idx" ON "media_files"("type");
CREATE INDEX IF NOT EXISTS "image_processing_queue_mediaFileId_idx" ON "image_processing_queue"("mediaFileId");
CREATE INDEX IF NOT EXISTS "image_processing_queue_status_idx" ON "image_processing_queue"("status");
CREATE INDEX IF NOT EXISTS "action_logs_userId_idx" ON "action_logs"("userId");
CREATE INDEX IF NOT EXISTS "action_logs_action_idx" ON "action_logs"("action");
CREATE INDEX IF NOT EXISTS "action_logs_entity_entityId_idx" ON "action_logs"("entity", "entityId");
CREATE INDEX IF NOT EXISTS "action_logs_createdAt_idx" ON "action_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "promo_campaigns_code_key" ON "promo_campaigns"("code");
CREATE INDEX IF NOT EXISTS "promo_campaigns_code_idx" ON "promo_campaigns"("code");
CREATE INDEX IF NOT EXISTS "promo_campaigns_isActive_idx" ON "promo_campaigns"("isActive");
CREATE INDEX IF NOT EXISTS "promo_campaigns_startDate_endDate_idx" ON "promo_campaigns"("startDate", "endDate");
CREATE INDEX IF NOT EXISTS "wishlist_items_userId_idx" ON "wishlist_items"("userId");
CREATE INDEX IF NOT EXISTS "wishlist_items_productId_idx" ON "wishlist_items"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "wishlist_items_userId_productId_key" ON "wishlist_items"("userId", "productId");
CREATE INDEX IF NOT EXISTS "simplex_contacts_userId_idx" ON "simplex_contacts"("userId");
CREATE INDEX IF NOT EXISTS "simplex_contacts_profileType_idx" ON "simplex_contacts"("profileType");
CREATE INDEX IF NOT EXISTS "simplex_contacts_active_idx" ON "simplex_contacts"("active");
CREATE INDEX IF NOT EXISTS "simplex_messages_simplexContactId_idx" ON "simplex_messages"("simplexContactId");
CREATE INDEX IF NOT EXISTS "simplex_messages_direction_idx" ON "simplex_messages"("direction");
CREATE INDEX IF NOT EXISTS "simplex_messages_receivedAt_idx" ON "simplex_messages"("receivedAt");
CREATE INDEX IF NOT EXISTS "simplex_messages_orderId_idx" ON "simplex_messages"("orderId");
CREATE INDEX IF NOT EXISTS "relationship_contexts_customerId_idx" ON "relationship_contexts"("customerId");
CREATE INDEX IF NOT EXISTS "relationship_contexts_confectionerId_idx" ON "relationship_contexts"("confectionerId");
CREATE INDEX IF NOT EXISTS "relationship_contexts_relationshipType_idx" ON "relationship_contexts"("relationshipType");
CREATE UNIQUE INDEX IF NOT EXISTS "relationship_contexts_customerId_confectionerId_key" ON "relationship_contexts"("customerId", "confectionerId");
CREATE INDEX IF NOT EXISTS "conversation_memories_customerId_idx" ON "conversation_memories"("customerId");
CREATE INDEX IF NOT EXISTS "conversation_memories_confectionerId_idx" ON "conversation_memories"("confectionerId");
CREATE INDEX IF NOT EXISTS "conversation_memories_customerId_confectionerId_idx" ON "conversation_memories"("customerId", "confectionerId");
CREATE INDEX IF NOT EXISTS "conversation_memories_memoryType_idx" ON "conversation_memories"("memoryType");
CREATE INDEX IF NOT EXISTS "conversation_memories_isGlobal_idx" ON "conversation_memories"("isGlobal");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_learning_profiles_userId_key" ON "ai_learning_profiles"("userId");
CREATE INDEX IF NOT EXISTS "ai_learning_profiles_userId_idx" ON "ai_learning_profiles"("userId");
CREATE INDEX IF NOT EXISTS "ai_learning_logs_userId_idx" ON "ai_learning_logs"("userId");
CREATE INDEX IF NOT EXISTS "ai_learning_logs_confectionerId_idx" ON "ai_learning_logs"("confectionerId");
CREATE INDEX IF NOT EXISTS "ai_learning_logs_sourceType_idx" ON "ai_learning_logs"("sourceType");