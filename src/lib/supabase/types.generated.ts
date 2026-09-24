/* eslint-disable */
/**
 * types.generated.ts — АВТОГЕНЕРИРОВАННЫЙ supabase-совместимый Database тип.
 *
 * НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ.
 * Генератор: scripts/generate-supabase-types.mjs (работает без Docker/CLI):
 *   node scripts/generate-supabase-types.mjs "postgresql://postgres@localhost:5432/conditera"
 *
 * Схемы: public, storage. Кол-во таблиц: 209 (public) + 2 (storage).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ---- Enums (top-level, как в supabase gen types) ----
export type AccountType = "individual" | "legal"
export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "PERMISSION_GRANT" | "PERMISSION_REVOKE" | "BAN" | "UNBAN"
export type FillingCategory = "CREAM" | "CHOCOLATE" | "BERRY" | "CARAMEL" | "NUT" | "FRUIT" | "CLASSIC" | "MOUSSE" | "CUSTARD" | "OTHER"
export type FillingStatus = "APPROVED" | "PENDING" | "REJECTED"
export type LoyaltyLevel = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM"
export type LoyaltyTxType = "EARN" | "REDEEM" | "EXPIRE" | "REFUND" | "ADJUST" | "BONUS_WELCOME" | "BONUS_BIRTHDAY" | "BONUS_REFERRAL"
export type MaintenanceStatus = "queued" | "running" | "success" | "failed" | "partial"
export type MaintenanceType = "BACKUP_FULL" | "BACKUP_INCREMENTAL" | "CLEANUP_LOGS" | "CLEANUP_SESSIONS" | "CLEANUP_NOTIFICATIONS" | "CLEANUP_CARTS" | "CLEANUP_ORPHANS" | "VACUUM"
export type NotificationChannel = "email" | "sms" | "push" | "in_app" | "telegram"
export type NotificationStatus = "queued" | "sent" | "delivered" | "failed" | "read" | "dismissed"
export type NotificationTemplate = "ORDER_CREATED" | "ORDER_CONFIRMED" | "ORDER_STATUS_CHANGED" | "ORDER_ACCEPTED" | "ORDER_IN_PRODUCTION" | "ORDER_READY" | "ORDER_READY_FOR_PICKUP" | "ORDER_OUT_FOR_DELIVERY" | "ORDER_RECEIVED" | "ORDER_DELIVERED" | "ORDER_CANCELLED" | "PAYMENT_SUCCEEDED" | "PAYMENT_PARTIAL" | "PAYMENT_FAILED" | "REFUND_PROCESSED" | "NEGOTIATION_RECEIVED" | "NEGOTIATION_QUOTED" | "NEGOTIATION_APPROVED" | "NEGOTIATION_REJECTED" | "NEW_MESSAGE" | "NEW_REVIEW" | "REVIEW_REPLY" | "BONUS_EARNED" | "BONUS_EXPIRING" | "LEVEL_UP" | "BIRTHDAY_GREETING" | "REFERRAL_REWARDED" | "PROMO_NEAR_YOU" | "ABANDONED_CART" | "VERIFICATION_APPROVED" | "VERIFICATION_REJECTED" | "PAYOUT_PROCESSED" | "SUPPORT_REPLY"
export type OrderStatus = "PENDING" | "NEGOTIATING" | "CONFIRMED" | "PREPARING" | "READY" | "IN_DELIVERY" | "DELIVERED" | "COMPLETED" | "CANCELLED" | "REFUNDED"
export type OrganizationStatus = "ACTIVE" | "LIQUIDATING" | "LIQUIDATED" | "REORGANIZING" | "UNKNOWN"
export type PaymentMethod = "card" | "sbp" | "cash" | "split" | "installment" | "yookassa" | "self"
export type PaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "escrow" | "released" | "cancelled" | "refunded"
export type Tariff = "START" | "BASIC" | "PREMIUM" | "BUSINESS"
export type TaxMode = "NPD" | "USN" | "OSNO" | "PSN" | "SELF_EMPLOYED"
export type TrustLevel = "NEW" | "VERIFIED" | "MASTER" | "EXPERT"
export type UserRole = "CUSTOMER" | "CONFECTIONER" | "ADMIN" | "SUPER_ADMIN" | "COURIER" | "SUPPLIER" | "VENUE_OWNER" | "ANIMATOR_AGENCY" | "RECREATION_CENTER" | "KIDS_CLUB" | "GUEST" | "MODERATOR" | "SUPPORT" | "STUDIO" | "BLOGGER" | "TASTER" | "FRANCHISEE" | "NUTRITIONIST" | "CORPORATE_CLIENT" | "QUALITY_INSPECTOR" | "CERTIFICATION_AGENT" | "COPYWRITER" | "FOOD_SERVICE" | "EVENT_ORGANIZER" | "PICKUP_POINT" | "WHOLESALER"
export type VerificationTrigger = "REGISTRATION" | "PROFILE_UPDATE" | "INVOICE_ISSUE" | "PAYOUT_REQUEST" | "CRON_PERIODIC" | "ADMIN_MANUAL"
export type account_type = "individual" | "legal"
export type loyalty_level = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM"
export type order_status = "PENDING" | "NEGOTIATING" | "CONFIRMED" | "PREPARING" | "READY" | "IN_DELIVERY" | "DELIVERED" | "COMPLETED" | "CANCELLED" | "REFUNDED"
export type payment_method = "card" | "sbp" | "cash" | "split" | "installment" | "yookassa" | "self"
export type payment_status = "pending" | "waiting_for_capture" | "succeeded" | "escrow" | "released" | "cancelled" | "refunded"
export type tariff = "START" | "BASIC" | "PREMIUM" | "BUSINESS"
export type tax_mode = "NPD" | "USN" | "OSNO" | "PSN" | "SELF_EMPLOYED"
export type trust_level = "NEW" | "VERIFIED" | "MASTER" | "EXPERT"
export type user_role = "CUSTOMER" | "CONFECTIONER" | "ADMIN" | "SUPER_ADMIN" | "COURIER" | "SUPPLIER" | "VENUE_OWNER" | "ANIMATOR_AGENCY" | "RECREATION_CENTER" | "KIDS_CLUB" | "GUEST" | "MODERATOR" | "SUPPORT" | "STUDIO" | "BLOGGER" | "TASTER" | "FRANCHISEE" | "NUTRITIONIST" | "CORPORATE_CLIENT" | "QUALITY_INSPECTOR" | "CERTIFICATION_AGENT" | "COPYWRITER" | "FOOD_SERVICE" | "EVENT_ORGANIZER" | "PICKUP_POINT" | "WHOLESALER" | "INSPECTOR" | "RECIPE_DEVELOPER" | "LOYALTY_PARTNER" | "AI_ASSISTANT"

export type Database = {
  public: {
    Tables: {
      abandoned_cart_logs: {
        Row: {
          id: string
          user_id: string | null
          session_id: string | null
          cart_items: Json
          cart_total: number
          cart_items_count: number
          abandoned_at: string
          reminder_sent_at: string | null
          reminder_channel: string | null
          reminder_status: string | null
          recovered_at: string | null
          recovery_order_id: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          cart_items: Json
          cart_total?: number
          cart_items_count?: number
          abandoned_at?: string
          reminder_sent_at?: string | null
          reminder_channel?: string | null
          reminder_status?: string | null
          recovered_at?: string | null
          recovery_order_id?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          cart_items?: Json
          cart_total?: number
          cart_items_count?: number
          abandoned_at?: string
          reminder_sent_at?: string | null
          reminder_channel?: string | null
          reminder_status?: string | null
          recovered_at?: string | null
          recovery_order_id?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      accounts: {
        Row: {
          id: string
          userId: string
          provider: string
          providerAccountId: string
          refreshToken: string | null
          accessToken: string | null
          accessTokenExpiresAt: string | null
          refreshTokenExpiresAt: string | null
          scope: string | null
          tokenType: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          provider: string
          providerAccountId: string
          refreshToken?: string | null
          accessToken?: string | null
          accessTokenExpiresAt?: string | null
          refreshTokenExpiresAt?: string | null
          scope?: string | null
          tokenType?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          provider?: string
          providerAccountId?: string
          refreshToken?: string | null
          accessToken?: string | null
          accessTokenExpiresAt?: string | null
          refreshTokenExpiresAt?: string | null
          scope?: string | null
          tokenType?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      action_logs: {
        Row: {
          id: string
          userId: string | null
          action: string
          entity: string | null
          entityId: string | null
          metadata: Json | null
          ip: string | null
          userAgent: string | null
          createdAt: string
        }
        Insert: {
          id: string
          userId?: string | null
          action: string
          entity?: string | null
          entityId?: string | null
          metadata?: Json | null
          ip?: string | null
          userAgent?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string | null
          action?: string
          entity?: string | null
          entityId?: string | null
          metadata?: Json | null
          ip?: string | null
          userAgent?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      addresses: {
        Row: {
          id: string
          user_id: string
          label: string | null
          text: string
          lat: number | null
          lng: number | null
          is_default: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          label?: string | null
          text: string
          lat?: number | null
          lng?: number | null
          is_default?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          label?: string | null
          text?: string
          lat?: number | null
          lng?: number | null
          is_default?: boolean | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      ai_assistant_conversations: {
        Row: {
          id: string
          user_id: string
          role_context: user_role
          title: string | null
          message_count: number
          last_message_at: string | null
          is_archived: boolean
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role_context: user_role
          title?: string | null
          message_count?: number
          last_message_at?: string | null
          is_archived?: boolean
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          role_context?: user_role
          title?: string | null
          message_count?: number
          last_message_at?: string | null
          is_archived?: boolean
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      ai_assistant_logs: {
        Row: {
          id: number
          conversation_id: string | null
          user_id: string | null
          role_context: user_role | null
          request_type: string
          input_text: string
          output_text: string | null
          input_tokens: number | null
          output_tokens: number | null
          model_used: string | null
          latency_ms: number | null
          was_helpful: boolean | null
          feedback_text: string | null
          error_code: string | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: number
          conversation_id?: string | null
          user_id?: string | null
          role_context?: user_role | null
          request_type: string
          input_text: string
          output_text?: string | null
          input_tokens?: number | null
          output_tokens?: number | null
          model_used?: string | null
          latency_ms?: number | null
          was_helpful?: boolean | null
          feedback_text?: string | null
          error_code?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          conversation_id?: string | null
          user_id?: string | null
          role_context?: user_role | null
          request_type?: string
          input_text?: string
          output_text?: string | null
          input_tokens?: number | null
          output_tokens?: number | null
          model_used?: string | null
          latency_ms?: number | null
          was_helpful?: boolean | null
          feedback_text?: string | null
          error_code?: string | null
          error_message?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_conversations"
            referencedColumns: ["id"]
          }
        ]
      }
      ai_learning_logs: {
        Row: {
          id: string
          userId: string
          confectionerId: string | null
          sourceType: string
          sourceId: string | null
          extractedFacts: Json | null
          memoriesCreated: number
          userFeedback: string | null
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          confectionerId?: string | null
          sourceType: string
          sourceId?: string | null
          extractedFacts?: Json | null
          memoriesCreated?: number
          userFeedback?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          confectionerId?: string | null
          sourceType?: string
          sourceId?: string | null
          extractedFacts?: Json | null
          memoriesCreated?: number
          userFeedback?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      ai_learning_profiles: {
        Row: {
          id: string
          userId: string
          globalPreferences: Json | null
          communicationStyle: Json | null
          behaviorPatterns: Json | null
          suggestionStats: Json | null
          lastLearnedAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          globalPreferences?: Json | null
          communicationStyle?: Json | null
          behaviorPatterns?: Json | null
          suggestionStats?: Json | null
          lastLearnedAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          globalPreferences?: Json | null
          communicationStyle?: Json | null
          behaviorPatterns?: Json | null
          suggestionStats?: Json | null
          lastLearnedAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      ateliers: {
        Row: {
          id: string
          confectioner_geo_id: string
          name: string
          description: string | null
          lat: number | null
          lng: number | null
          address: string | null
          services: string[] | null
          photos: string[] | null
          working_hours: Json | null
          capacity: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          confectioner_geo_id: string
          name: string
          description?: string | null
          lat?: number | null
          lng?: number | null
          address?: string | null
          services?: string[] | null
          photos?: string[] | null
          working_hours?: Json | null
          capacity?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          confectioner_geo_id?: string
          name?: string
          description?: string | null
          lat?: number | null
          lng?: number | null
          address?: string | null
          services?: string[] | null
          photos?: string[] | null
          working_hours?: Json | null
          capacity?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ateliers_confectioner_geo_id_fkey"
            columns: ["confectioner_geo_id"]
            isOneToOne: false
            referencedRelation: "confectioner_geo"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_log: {
        Row: {
          id: string
          user_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          metadata: Json | null
          ip: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          entity_type?: string | null
          entity_id?: string | null
          metadata?: Json | null
          ip?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          metadata?: Json | null
          ip?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      audit_logs: {
        Row: {
          id: string
          userId: string | null
          action: string
          entity: string | null
          entityId: string | null
          metadata: Json | null
          ip: string | null
          userAgent: string | null
          timestamp: string
          createdAt: string
        }
        Insert: {
          id: string
          userId?: string | null
          action: string
          entity?: string | null
          entityId?: string | null
          metadata?: Json | null
          ip?: string | null
          userAgent?: string | null
          timestamp?: string
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string | null
          action?: string
          entity?: string | null
          entityId?: string | null
          metadata?: Json | null
          ip?: string | null
          userAgent?: string | null
          timestamp?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      badges: {
        Row: {
          id: string
          code: string
          name: string
          description: string | null
          icon: string | null
          category: string | null
          requirement: Json | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          code: string
          name: string
          description?: string | null
          icon?: string | null
          category?: string | null
          requirement?: Json | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          code?: string
          name?: string
          description?: string | null
          icon?: string | null
          category?: string | null
          requirement?: Json | null
          is_active?: boolean | null
        }
        Relationships: [
        ]
      }
      banners: {
        Row: {
          id: string
          title: string
          subtitle: string | null
          image: string
          link: string | null
          buttonText: string | null
          position: string
          isActive: boolean
          sortOrder: number
          startDate: string | null
          endDate: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          title: string
          subtitle?: string | null
          image: string
          link?: string | null
          buttonText?: string | null
          position?: string
          isActive?: boolean
          sortOrder?: number
          startDate?: string | null
          endDate?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          title?: string
          subtitle?: string | null
          image?: string
          link?: string | null
          buttonText?: string | null
          position?: string
          isActive?: boolean
          sortOrder?: number
          startDate?: string | null
          endDate?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      blacklist: {
        Row: {
          id: string
          scope: string
          value: string
          userId: string | null
          reason: string
          reasonDetails: string
          blockedBy: string
          blockedAt: string
          isPermanent: boolean
          expiresAt: string | null
          status: string
        }
        Insert: {
          id: string
          scope: string
          value: string
          userId?: string | null
          reason: string
          reasonDetails: string
          blockedBy: string
          blockedAt?: string
          isPermanent?: boolean
          expiresAt?: string | null
          status?: string
        }
        Update: {
          id?: string
          scope?: string
          value?: string
          userId?: string | null
          reason?: string
          reasonDetails?: string
          blockedBy?: string
          blockedAt?: string
          isPermanent?: boolean
          expiresAt?: string | null
          status?: string
        }
        Relationships: [
        ]
      }
      blogger_profiles: {
        Row: {
          id: string
          userId: string
          referralCode: string
          followersCount: number
          postsCount: number
          clicksCount: number
          conversionsCount: number
          totalEarned: number
          platform: string | null
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          referralCode: string
          followersCount?: number
          postsCount?: number
          clicksCount?: number
          conversionsCount?: number
          totalEarned?: number
          platform?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          referralCode?: string
          followersCount?: number
          postsCount?: number
          clicksCount?: number
          conversionsCount?: number
          totalEarned?: number
          platform?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      builder_config: {
        Row: {
          id: string
          category: string
          key: string
          label: string
          description: string | null
          icon: string | null
          price_modifier: number | null
          sort_order: number | null
          is_active: boolean | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          category: string
          key: string
          label: string
          description?: string | null
          icon?: string | null
          price_modifier?: number | null
          sort_order?: number | null
          is_active?: boolean | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          category?: string
          key?: string
          label?: string
          description?: string | null
          icon?: string | null
          price_modifier?: number | null
          sort_order?: number | null
          is_active?: boolean | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      builder_decor_shops: {
        Row: {
          id: string
          name: string
          description: string | null
          logo: string | null
          website: string | null
          city: string | null
          delivery_cities: string[] | null
          avg_price_level: string | null
          rating: number | null
          reviews_count: number | null
          is_active: boolean | null
          is_verified: boolean | null
          categories: string[] | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          logo?: string | null
          website?: string | null
          city?: string | null
          delivery_cities?: string[] | null
          avg_price_level?: string | null
          rating?: number | null
          reviews_count?: number | null
          is_active?: boolean | null
          is_verified?: boolean | null
          categories?: string[] | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          logo?: string | null
          website?: string | null
          city?: string | null
          delivery_cities?: string[] | null
          avg_price_level?: string | null
          rating?: number | null
          reviews_count?: number | null
          is_active?: boolean | null
          is_verified?: boolean | null
          categories?: string[] | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      builder_partner_offers: {
        Row: {
          id: string
          partner_id: string
          partner_type: string
          partner_name: string
          partner_avatar: string | null
          city: string | null
          product_type: string | null
          avg_price: number | null
          min_price: number | null
          max_price: number | null
          rating: number | null
          reviews_count: number | null
          is_verified: boolean | null
          is_active: boolean | null
          specialties: string[] | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          partner_id: string
          partner_type: string
          partner_name: string
          partner_avatar?: string | null
          city?: string | null
          product_type?: string | null
          avg_price?: number | null
          min_price?: number | null
          max_price?: number | null
          rating?: number | null
          reviews_count?: number | null
          is_verified?: boolean | null
          is_active?: boolean | null
          specialties?: string[] | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          partner_id?: string
          partner_type?: string
          partner_name?: string
          partner_avatar?: string | null
          city?: string | null
          product_type?: string | null
          avg_price?: number | null
          min_price?: number | null
          max_price?: number | null
          rating?: number | null
          reviews_count?: number | null
          is_verified?: boolean | null
          is_active?: boolean | null
          specialties?: string[] | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      business_expenses: {
        Row: {
          id: string
          confectionerId: string
          category: string
          amount: number
          description: string | null
          date: string
          receiptUrl: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          category: string
          amount: number
          description?: string | null
          date?: string
          receiptUrl?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          confectionerId?: string
          category?: string
          amount?: number
          description?: string | null
          date?: string
          receiptUrl?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      cake_builder_drafts: {
        Row: {
          id: string
          user_id: string
          event_type: string | null
          base: string | null
          filling: string | null
          coating: string | null
          decorations: string[] | null
          dietary: string[] | null
          servings: number | null
          city: string | null
          delivery_date: string | null
          delivery_type: string | null
          inscription: string | null
          comment: string | null
          step: number | null
          is_submitted: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          event_type?: string | null
          base?: string | null
          filling?: string | null
          coating?: string | null
          decorations?: string[] | null
          dietary?: string[] | null
          servings?: number | null
          city?: string | null
          delivery_date?: string | null
          delivery_type?: string | null
          inscription?: string | null
          comment?: string | null
          step?: number | null
          is_submitted?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          event_type?: string | null
          base?: string | null
          filling?: string | null
          coating?: string | null
          decorations?: string[] | null
          dietary?: string[] | null
          servings?: number | null
          city?: string | null
          delivery_date?: string | null
          delivery_type?: string | null
          inscription?: string | null
          comment?: string | null
          step?: number | null
          is_submitted?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      cake_builder_options: {
        Row: {
          id: string
          category: string
          key: string
          name: string
          description: string | null
          price_modifier: number | null
          image_url: string | null
          is_active: boolean | null
          sort_order: number | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          category: string
          key: string
          name: string
          description?: string | null
          price_modifier?: number | null
          image_url?: string | null
          is_active?: boolean | null
          sort_order?: number | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          category?: string
          key?: string
          name?: string
          description?: string | null
          price_modifier?: number | null
          image_url?: string | null
          is_active?: boolean | null
          sort_order?: number | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      cake_subscriptions: {
        Row: {
          id: string
          customerId: string
          confectionerId: string
          productId: string
          schedule: string
          discountPercent: number
          servings: number
          pricePerDelivery: number
          deliveryAddress: string | null
          deliveryCity: string | null
          paymentMethod: string
          yookassaPaymentId: string | null
          nextDeliveryAt: string
          lastDeliveryAt: string | null
          status: string
          cancelReason: string | null
          deliveriesCount: number
          totalSpent: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          customerId: string
          confectionerId: string
          productId: string
          schedule?: string
          discountPercent?: number
          servings?: number
          pricePerDelivery: number
          deliveryAddress?: string | null
          deliveryCity?: string | null
          paymentMethod?: string
          yookassaPaymentId?: string | null
          nextDeliveryAt: string
          lastDeliveryAt?: string | null
          status?: string
          cancelReason?: string | null
          deliveriesCount?: number
          totalSpent?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          customerId?: string
          confectionerId?: string
          productId?: string
          schedule?: string
          discountPercent?: number
          servings?: number
          pricePerDelivery?: number
          deliveryAddress?: string | null
          deliveryCity?: string | null
          paymentMethod?: string
          yookassaPaymentId?: string | null
          nextDeliveryAt?: string
          lastDeliveryAt?: string | null
          status?: string
          cancelReason?: string | null
          deliveriesCount?: number
          totalSpent?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      canned_responses: {
        Row: {
          id: string
          title: string
          body: string
          category: string | null
          created_by: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          title: string
          body: string
          category?: string | null
          created_by?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          body?: string
          category?: string | null
          created_by?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      cart_items: {
        Row: {
          id: string
          user_id: string | null
          session_id: string | null
          product_id: string
          quantity: number
          selected_attributes: Json | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          product_id: string
          quantity?: number
          selected_attributes?: Json | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          product_id?: string
          quantity?: number
          selected_attributes?: Json | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      certification_agent_profiles: {
        Row: {
          id: string
          userId: string
          license: string | null
          licenseExpiresAt: string | null
          certificationsCount: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          license?: string | null
          licenseExpiresAt?: string | null
          certificationsCount?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          license?: string | null
          licenseExpiresAt?: string | null
          certificationsCount?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      challenges: {
        Row: {
          id: string
          name: string
          description: string | null
          type: string | null
          target_value: number
          reward_type: string | null
          reward_value: number | null
          starts_at: string | null
          ends_at: string | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type?: string | null
          target_value: number
          reward_type?: string | null
          reward_value?: number | null
          starts_at?: string | null
          ends_at?: string | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: string | null
          target_value?: number
          reward_type?: string | null
          reward_value?: number | null
          starts_at?: string | null
          ends_at?: string | null
          is_active?: boolean | null
        }
        Relationships: [
        ]
      }
      channel_comments: {
        Row: {
          id: string
          postId: string
          userId: string
          text: string
          isDeleted: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          postId: string
          userId: string
          text: string
          isDeleted?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          postId?: string
          userId?: string
          text?: string
          isDeleted?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      channel_followers: {
        Row: {
          id: string
          confectionerId: string
          userId: string
          createdAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          userId: string
          createdAt?: string
        }
        Update: {
          id?: string
          confectionerId?: string
          userId?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      channel_likes: {
        Row: {
          id: string
          postId: string
          userId: string
          createdAt: string
        }
        Insert: {
          id: string
          postId: string
          userId: string
          createdAt?: string
        }
        Update: {
          id?: string
          postId?: string
          userId?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      channel_posts: {
        Row: {
          id: string
          confectionerId: string
          content: string
          images: string[] | null
          likesCount: number
          commentsCount: number
          isPinned: boolean
          isPublished: boolean
          publishedAt: string
          createdAt: string
          updatedAt: string
          moderation_status: string | null
          moderated_by: string | null
          moderated_at: string | null
          rejection_reason: string | null
          telegram_message_id: number | null
          telegram_posted_at: string | null
          telegram_post_error: string | null
        }
        Insert: {
          id: string
          confectionerId: string
          content: string
          images?: string[] | null
          likesCount?: number
          commentsCount?: number
          isPinned?: boolean
          isPublished?: boolean
          publishedAt?: string
          createdAt?: string
          updatedAt: string
          moderation_status?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          rejection_reason?: string | null
          telegram_message_id?: number | null
          telegram_posted_at?: string | null
          telegram_post_error?: string | null
        }
        Update: {
          id?: string
          confectionerId?: string
          content?: string
          images?: string[] | null
          likesCount?: number
          commentsCount?: number
          isPinned?: boolean
          isPublished?: boolean
          publishedAt?: string
          createdAt?: string
          updatedAt?: string
          moderation_status?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          rejection_reason?: string | null
          telegram_message_id?: number | null
          telegram_posted_at?: string | null
          telegram_post_error?: string | null
        }
        Relationships: [
        ]
      }
      channel_stories: {
        Row: {
          id: string
          confectionerId: string
          image: string
          video: string | null
          type: string
          caption: string | null
          duration: number
          productId: string | null
          promotionId: string | null
          viewsCount: number
          likesCount: number
          repliesCount: number
          viewedBy: string[] | null
          expiresAt: string
          sortOrder: number
          createdAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          image: string
          video?: string | null
          type?: string
          caption?: string | null
          duration?: number
          productId?: string | null
          promotionId?: string | null
          viewsCount?: number
          likesCount?: number
          repliesCount?: number
          viewedBy?: string[] | null
          expiresAt: string
          sortOrder?: number
          createdAt?: string
        }
        Update: {
          id?: string
          confectionerId?: string
          image?: string
          video?: string | null
          type?: string
          caption?: string | null
          duration?: number
          productId?: string | null
          promotionId?: string | null
          viewsCount?: number
          likesCount?: number
          repliesCount?: number
          viewedBy?: string[] | null
          expiresAt?: string
          sortOrder?: number
          createdAt?: string
        }
        Relationships: [
        ]
      }
      chat_channel_members: {
        Row: {
          id: string
          channel_id: string
          user_id: string
          role: string | null
          muted: boolean | null
          last_read_message_id: string | null
          last_read_at: string | null
          joined_at: string | null
          left_at: string | null
        }
        Insert: {
          id?: string
          channel_id: string
          user_id: string
          role?: string | null
          muted?: boolean | null
          last_read_message_id?: string | null
          last_read_at?: string | null
          joined_at?: string | null
          left_at?: string | null
        }
        Update: {
          id?: string
          channel_id?: string
          user_id?: string
          role?: string | null
          muted?: boolean | null
          last_read_message_id?: string | null
          last_read_at?: string | null
          joined_at?: string | null
          left_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channel_members_last_read_fk"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_channels: {
        Row: {
          id: string
          type: string
          name: string | null
          negotiation_id: string | null
          support_ticket_id: string | null
          last_message_at: string | null
          last_message_text: string | null
          messages_count: number | null
          created_at: string | null
          updated_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          type?: string
          name?: string | null
          negotiation_id?: string | null
          support_ticket_id?: string | null
          last_message_at?: string | null
          last_message_text?: string | null
          messages_count?: number | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          type?: string
          name?: string | null
          negotiation_id?: string | null
          support_ticket_id?: string | null
          last_message_at?: string | null
          last_message_text?: string | null
          messages_count?: number | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_escalations: {
        Row: {
          id: string
          chat_room_id: string
          user_id: string | null
          reason: string | null
          priority: string
          status: string
          assigned_to: string | null
          assigned_at: string | null
          resolved_by: string | null
          resolved_at: string | null
          resolution: string | null
          messages_count: number
          wait_time_sec: number | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          chat_room_id: string
          user_id?: string | null
          reason?: string | null
          priority?: string
          status?: string
          assigned_to?: string | null
          assigned_at?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          resolution?: string | null
          messages_count?: number
          wait_time_sec?: number | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          chat_room_id?: string
          user_id?: string | null
          reason?: string | null
          priority?: string
          status?: string
          assigned_to?: string | null
          assigned_at?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          resolution?: string | null
          messages_count?: number
          wait_time_sec?: number | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      chat_message_reactions: {
        Row: {
          id: string
          message_id: string
          user_id: string
          emoji: string
          created_at: string | null
        }
        Insert: {
          id?: string
          message_id: string
          user_id: string
          emoji: string
          created_at?: string | null
        }
        Update: {
          id?: string
          message_id?: string
          user_id?: string
          emoji?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_message_reads: {
        Row: {
          id: string
          message_id: string
          user_id: string
          read_at: string | null
        }
        Insert: {
          id?: string
          message_id: string
          user_id: string
          read_at?: string | null
        }
        Update: {
          id?: string
          message_id?: string
          user_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_messages: {
        Row: {
          id: string
          channel_id: string
          sender_id: string
          text: string | null
          attachments: Json | null
          reply_to_id: string | null
          is_edited: boolean | null
          edited_at: string | null
          is_deleted: boolean | null
          deleted_at: string | null
          is_system: boolean | null
          system_event: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          channel_id: string
          sender_id: string
          text?: string | null
          attachments?: Json | null
          reply_to_id?: string | null
          is_edited?: boolean | null
          edited_at?: string | null
          is_deleted?: boolean | null
          deleted_at?: string | null
          is_system?: boolean | null
          system_event?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          channel_id?: string
          sender_id?: string
          text?: string | null
          attachments?: Json | null
          reply_to_id?: string | null
          is_edited?: boolean | null
          edited_at?: string | null
          is_deleted?: boolean | null
          deleted_at?: string | null
          is_system?: boolean | null
          system_event?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_notification_settings: {
        Row: {
          id: string
          userId: string
          roomId: string | null
          pushEnabled: boolean
          emailEnabled: boolean
          inAppEnabled: boolean
          muteUntil: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          roomId?: string | null
          pushEnabled?: boolean
          emailEnabled?: boolean
          inAppEnabled?: boolean
          muteUntil?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          roomId?: string | null
          pushEnabled?: boolean
          emailEnabled?: boolean
          inAppEnabled?: boolean
          muteUntil?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      chat_rooms: {
        Row: {
          id: string
          type: string
          name: string
          avatar: string | null
          participants: string[] | null
          lastMessage: string | null
          lastMessageAt: string | null
          orderId: string | null
          createdAt: string
        }
        Insert: {
          id: string
          type?: string
          name: string
          avatar?: string | null
          participants?: string[] | null
          lastMessage?: string | null
          lastMessageAt?: string | null
          orderId?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          type?: string
          name?: string
          avatar?: string | null
          participants?: string[] | null
          lastMessage?: string | null
          lastMessageAt?: string | null
          orderId?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      chat_typing: {
        Row: {
          id: string
          channel_id: string
          user_id: string
          created_at: string | null
          expires_at: string | null
        }
        Insert: {
          id?: string
          channel_id: string
          user_id: string
          created_at?: string | null
          expires_at?: string | null
        }
        Update: {
          id?: string
          channel_id?: string
          user_id?: string
          created_at?: string | null
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_typing_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          }
        ]
      }
      cms_banners: {
        Row: {
          id: string
          title: string
          image_url: string | null
          link_url: string | null
          position: string
          text: string | null
          cta_text: string | null
          starts_at: string | null
          ends_at: string | null
          target_audience: string[] | null
          is_active: boolean | null
          sort_order: number | null
          impressions_count: number | null
          clicks_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          title: string
          image_url?: string | null
          link_url?: string | null
          position?: string
          text?: string | null
          cta_text?: string | null
          starts_at?: string | null
          ends_at?: string | null
          target_audience?: string[] | null
          is_active?: boolean | null
          sort_order?: number | null
          impressions_count?: number | null
          clicks_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          image_url?: string | null
          link_url?: string | null
          position?: string
          text?: string | null
          cta_text?: string | null
          starts_at?: string | null
          ends_at?: string | null
          target_audience?: string[] | null
          is_active?: boolean | null
          sort_order?: number | null
          impressions_count?: number | null
          clicks_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      cms_blocks: {
        Row: {
          id: string
          pageId: string | null
          section: string
          title: string | null
          subtitle: string | null
          content: string | null
          image: string | null
          link: string | null
          linkText: string | null
          sortOrder: number
          isActive: boolean
          metadata: Json | null
          updatedAt: string
          updatedBy: string | null
        }
        Insert: {
          id: string
          pageId?: string | null
          section: string
          title?: string | null
          subtitle?: string | null
          content?: string | null
          image?: string | null
          link?: string | null
          linkText?: string | null
          sortOrder?: number
          isActive?: boolean
          metadata?: Json | null
          updatedAt: string
          updatedBy?: string | null
        }
        Update: {
          id?: string
          pageId?: string | null
          section?: string
          title?: string | null
          subtitle?: string | null
          content?: string | null
          image?: string | null
          link?: string | null
          linkText?: string | null
          sortOrder?: number
          isActive?: boolean
          metadata?: Json | null
          updatedAt?: string
          updatedBy?: string | null
        }
        Relationships: [
        ]
      }
      cms_media: {
        Row: {
          id: string
          name: string
          url: string
          type: string
          size_bytes: number | null
          mime_type: string | null
          alt_text: string | null
          width: number | null
          height: number | null
          uploaded_by: string | null
          is_public: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          url: string
          type: string
          size_bytes?: number | null
          mime_type?: string | null
          alt_text?: string | null
          width?: number | null
          height?: number | null
          uploaded_by?: string | null
          is_public?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          url?: string
          type?: string
          size_bytes?: number | null
          mime_type?: string | null
          alt_text?: string | null
          width?: number | null
          height?: number | null
          uploaded_by?: string | null
          is_public?: boolean | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      cms_nav_menu: {
        Row: {
          id: string
          location: string
          label: string
          url: string
          icon: string | null
          parent_id: string | null
          sort_order: number | null
          is_active: boolean | null
          show_for_roles: string[] | null
          show_for_authenticated: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          location?: string
          label: string
          url: string
          icon?: string | null
          parent_id?: string | null
          sort_order?: number | null
          is_active?: boolean | null
          show_for_roles?: string[] | null
          show_for_authenticated?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          location?: string
          label?: string
          url?: string
          icon?: string | null
          parent_id?: string | null
          sort_order?: number | null
          is_active?: boolean | null
          show_for_roles?: string[] | null
          show_for_authenticated?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_nav_menu_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cms_nav_menu"
            referencedColumns: ["id"]
          }
        ]
      }
      cms_page_history: {
        Row: {
          id: string
          page_id: string
          content: string
          version: number
          changed_by: string | null
          change_comment: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          page_id: string
          content: string
          version: number
          changed_by?: string | null
          change_comment?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          page_id?: string
          content?: string
          version?: number
          changed_by?: string | null
          change_comment?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_page_history_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          }
        ]
      }
      cms_pages: {
        Row: {
          id: string
          slug: string
          title: string
          description: string | null
          content: string
          seo_title: string | null
          seo_description: string | null
          seo_keywords: string[] | null
          status: string
          is_in_menu: boolean | null
          menu_order: number | null
          parent_id: string | null
          published_at: string | null
          created_at: string | null
          updated_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          slug: string
          title: string
          description?: string | null
          content: string
          seo_title?: string | null
          seo_description?: string | null
          seo_keywords?: string[] | null
          status?: string
          is_in_menu?: boolean | null
          menu_order?: number | null
          parent_id?: string | null
          published_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          slug?: string
          title?: string
          description?: string | null
          content?: string
          seo_title?: string | null
          seo_description?: string | null
          seo_keywords?: string[] | null
          status?: string
          is_in_menu?: boolean | null
          menu_order?: number | null
          parent_id?: string | null
          published_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          }
        ]
      }
      cms_section_blocks: {
        Row: {
          id: string
          sectionId: string
          type: string
          content: string | null
          order: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          sectionId: string
          type: string
          content?: string | null
          order?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          sectionId?: string
          type?: string
          content?: string | null
          order?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      cms_sections: {
        Row: {
          id: string
          slug: string
          title: string
          visible: boolean
          sortOrder: number
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          slug: string
          title: string
          visible?: boolean
          sortOrder?: number
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          slug?: string
          title?: string
          visible?: boolean
          sortOrder?: number
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      cms_site_settings: {
        Row: {
          key: string
          value: string
          value_type: string | null
          description: string | null
          category: string | null
          is_public: boolean | null
          updated_by: string | null
          updated_at: string | null
        }
        Insert: {
          key: string
          value: string
          value_type?: string | null
          description?: string | null
          category?: string | null
          is_public?: boolean | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Update: {
          key?: string
          value?: string
          value_type?: string | null
          description?: string | null
          category?: string | null
          is_public?: boolean | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      coatings: {
        Row: {
          id: string
          name: string
          description: string | null
          type: string
          price_modifier: number | null
          color_code: string | null
          is_active: boolean | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type?: string
          price_modifier?: number | null
          color_code?: string | null
          is_active?: boolean | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: string
          price_modifier?: number | null
          color_code?: string | null
          is_active?: boolean | null
          sort_order?: number | null
        }
        Relationships: [
        ]
      }
      confectioner_ateliers: {
        Row: {
          id: string
          confectionerId: string
          about: string | null
          workshopPhotos: string[] | null
          presentationVideo: string | null
          equipment: Json | null
          experienceYears: number
          education: Json | null
          certificates: Json | null
          awards: Json | null
          workingHours: Json | null
          teamSize: number
          techniques: string[] | null
          deliveryCities: string[] | null
          serviceRadiusKm: number
          socialLinks: Json | null
          totalStudents: number
          totalLessons: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          about?: string | null
          workshopPhotos?: string[] | null
          presentationVideo?: string | null
          equipment?: Json | null
          experienceYears?: number
          education?: Json | null
          certificates?: Json | null
          awards?: Json | null
          workingHours?: Json | null
          teamSize?: number
          techniques?: string[] | null
          deliveryCities?: string[] | null
          serviceRadiusKm?: number
          socialLinks?: Json | null
          totalStudents?: number
          totalLessons?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          confectionerId?: string
          about?: string | null
          workshopPhotos?: string[] | null
          presentationVideo?: string | null
          equipment?: Json | null
          experienceYears?: number
          education?: Json | null
          certificates?: Json | null
          awards?: Json | null
          workingHours?: Json | null
          teamSize?: number
          techniques?: string[] | null
          deliveryCities?: string[] | null
          serviceRadiusKm?: number
          socialLinks?: Json | null
          totalStudents?: number
          totalLessons?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      confectioner_capabilities: {
        Row: {
          id: string
          confectioner_id: string
          product_types: string[]
          bases: string[]
          filling_ids: string[]
          coatings: string[]
          shapes: string[]
          max_tiers: number
          decorations: string[]
          dietary: string[]
          additional_skills: string[]
          self_pickup: boolean | null
          self_delivery: boolean | null
          courier_delivery: boolean | null
          russia_delivery: boolean | null
          min_order_amount: number | null
          min_prep_days: number | null
          max_prep_days: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          confectioner_id: string
          product_types?: string[]
          bases?: string[]
          filling_ids?: string[]
          coatings?: string[]
          shapes?: string[]
          max_tiers?: number
          decorations?: string[]
          dietary?: string[]
          additional_skills?: string[]
          self_pickup?: boolean | null
          self_delivery?: boolean | null
          courier_delivery?: boolean | null
          russia_delivery?: boolean | null
          min_order_amount?: number | null
          min_prep_days?: number | null
          max_prep_days?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          confectioner_id?: string
          product_types?: string[]
          bases?: string[]
          filling_ids?: string[]
          coatings?: string[]
          shapes?: string[]
          max_tiers?: number
          decorations?: string[]
          dietary?: string[]
          additional_skills?: string[]
          self_pickup?: boolean | null
          self_delivery?: boolean | null
          courier_delivery?: boolean | null
          russia_delivery?: boolean | null
          min_order_amount?: number | null
          min_prep_days?: number | null
          max_prep_days?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_confectioner"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          }
        ]
      }
      confectioner_geo: {
        Row: {
          id: string
          confectioner_id: string
          lat: number | null
          lng: number | null
          address: string | null
          city: string | null
          delivery_radius_km: number | null
          working_hours: Json | null
          tasting_available: boolean | null
          tasting_price: number | null
          has_atelier: boolean | null
          is_active: boolean | null
          is_verified: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          confectioner_id: string
          lat?: number | null
          lng?: number | null
          address?: string | null
          city?: string | null
          delivery_radius_km?: number | null
          working_hours?: Json | null
          tasting_available?: boolean | null
          tasting_price?: number | null
          has_atelier?: boolean | null
          is_active?: boolean | null
          is_verified?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          confectioner_id?: string
          lat?: number | null
          lng?: number | null
          address?: string | null
          city?: string | null
          delivery_radius_km?: number | null
          working_hours?: Json | null
          tasting_available?: boolean | null
          tasting_price?: number | null
          has_atelier?: boolean | null
          is_active?: boolean | null
          is_verified?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confectioner_geo_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          }
        ]
      }
      confectioner_lessons: {
        Row: {
          id: string
          confectionerId: string
          type: string
          title: string
          description: string
          videoUrl: string | null
          videoDuration: number
          posterUrl: string | null
          presentationUrl: string | null
          chapters: Json | null
          materials: Json | null
          difficultyLevel: string
          price: number
          productId: string | null
          viewsCount: number
          likesCount: number
          enrolledCount: number
          rating: number
          reviewsCount: number
          tags: string[] | null
          status: string
          rejectionReason: string | null
          scheduledAt: string | null
          maxParticipants: number | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          type?: string
          title: string
          description: string
          videoUrl?: string | null
          videoDuration?: number
          posterUrl?: string | null
          presentationUrl?: string | null
          chapters?: Json | null
          materials?: Json | null
          difficultyLevel?: string
          price?: number
          productId?: string | null
          viewsCount?: number
          likesCount?: number
          enrolledCount?: number
          rating?: number
          reviewsCount?: number
          tags?: string[] | null
          status?: string
          rejectionReason?: string | null
          scheduledAt?: string | null
          maxParticipants?: number | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          confectionerId?: string
          type?: string
          title?: string
          description?: string
          videoUrl?: string | null
          videoDuration?: number
          posterUrl?: string | null
          presentationUrl?: string | null
          chapters?: Json | null
          materials?: Json | null
          difficultyLevel?: string
          price?: number
          productId?: string | null
          viewsCount?: number
          likesCount?: number
          enrolledCount?: number
          rating?: number
          reviewsCount?: number
          tags?: string[] | null
          status?: string
          rejectionReason?: string | null
          scheduledAt?: string | null
          maxParticipants?: number | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      confectioner_pricing: {
        Row: {
          id: string
          confectioner_id: string
          city: string
          base_price_per_portion: number
          base_price_per_kg: number
          min_order_price: number
          packaging_basic_price: number
          packaging_premium_price: number
          packaging_gift_price: number
          packaging_custom_price: number
          print_wafer_price: number
          print_chocolate_price: number
          print_topper_price: number
          print_photo_price: number
          decor_sugar_flowers_price: number
          decor_airbrush_price: number
          decor_hand_painting_price: number
          decor_3d_figures_price: number
          decor_isomalt_price: number
          decor_wafer_paper_price: number
          storage_standard_hours: number
          storage_extended_price: number
          storage_refrigerated_price: number
          delivery_in_city_price: number
          delivery_in_city_free_from: number
          delivery_suburb_price: number
          delivery_intercity_price: number
          delivery_express_price: number
          delivery_night_price: number
          delivery_self_pickup_discount: number
          service_installation_price: number
          service_tasting_price: number
          service_urgency_surcharge: number
          service_urgency_min_days: number
          service_inscription_price: number
          service_custom_design_price: number
          accepts_discount_requests: boolean
          max_discount_percent: number
          discount_min_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          confectioner_id: string
          city: string
          base_price_per_portion?: number
          base_price_per_kg?: number
          min_order_price?: number
          packaging_basic_price?: number
          packaging_premium_price?: number
          packaging_gift_price?: number
          packaging_custom_price?: number
          print_wafer_price?: number
          print_chocolate_price?: number
          print_topper_price?: number
          print_photo_price?: number
          decor_sugar_flowers_price?: number
          decor_airbrush_price?: number
          decor_hand_painting_price?: number
          decor_3d_figures_price?: number
          decor_isomalt_price?: number
          decor_wafer_paper_price?: number
          storage_standard_hours?: number
          storage_extended_price?: number
          storage_refrigerated_price?: number
          delivery_in_city_price?: number
          delivery_in_city_free_from?: number
          delivery_suburb_price?: number
          delivery_intercity_price?: number
          delivery_express_price?: number
          delivery_night_price?: number
          delivery_self_pickup_discount?: number
          service_installation_price?: number
          service_tasting_price?: number
          service_urgency_surcharge?: number
          service_urgency_min_days?: number
          service_inscription_price?: number
          service_custom_design_price?: number
          accepts_discount_requests?: boolean
          max_discount_percent?: number
          discount_min_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          confectioner_id?: string
          city?: string
          base_price_per_portion?: number
          base_price_per_kg?: number
          min_order_price?: number
          packaging_basic_price?: number
          packaging_premium_price?: number
          packaging_gift_price?: number
          packaging_custom_price?: number
          print_wafer_price?: number
          print_chocolate_price?: number
          print_topper_price?: number
          print_photo_price?: number
          decor_sugar_flowers_price?: number
          decor_airbrush_price?: number
          decor_hand_painting_price?: number
          decor_3d_figures_price?: number
          decor_isomalt_price?: number
          decor_wafer_paper_price?: number
          storage_standard_hours?: number
          storage_extended_price?: number
          storage_refrigerated_price?: number
          delivery_in_city_price?: number
          delivery_in_city_free_from?: number
          delivery_suburb_price?: number
          delivery_intercity_price?: number
          delivery_express_price?: number
          delivery_night_price?: number
          delivery_self_pickup_discount?: number
          service_installation_price?: number
          service_tasting_price?: number
          service_urgency_surcharge?: number
          service_urgency_min_days?: number
          service_inscription_price?: number
          service_custom_design_price?: number
          accepts_discount_requests?: boolean
          max_discount_percent?: number
          discount_min_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "confectioner_pricing_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          }
        ]
      }
      confectioner_quotes: {
        Row: {
          id: string
          quote_request_id: string
          confectioner_id: string
          base_cost: number
          filling_cost: number
          coating_cost: number
          decoration_cost: number
          packaging_cost: number
          printing_cost: number
          storage_cost: number
          delivery_cost: number
          service_cost: number
          custom_design_cost: number
          subtotal: number
          discount_percent: number
          discount_amount: number
          total_price: number
          prep_days: number
          available_date: string | null
          comment: string | null
          offered_packaging: string | null
          offered_delivery: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quote_request_id: string
          confectioner_id: string
          base_cost?: number
          filling_cost?: number
          coating_cost?: number
          decoration_cost?: number
          packaging_cost?: number
          printing_cost?: number
          storage_cost?: number
          delivery_cost?: number
          service_cost?: number
          custom_design_cost?: number
          subtotal?: number
          discount_percent?: number
          discount_amount?: number
          total_price?: number
          prep_days?: number
          available_date?: string | null
          comment?: string | null
          offered_packaging?: string | null
          offered_delivery?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          quote_request_id?: string
          confectioner_id?: string
          base_cost?: number
          filling_cost?: number
          coating_cost?: number
          decoration_cost?: number
          packaging_cost?: number
          printing_cost?: number
          storage_cost?: number
          delivery_cost?: number
          service_cost?: number
          custom_design_cost?: number
          subtotal?: number
          discount_percent?: number
          discount_amount?: number
          total_price?: number
          prep_days?: number
          available_date?: string | null
          comment?: string | null
          offered_packaging?: string | null
          offered_delivery?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "confectioner_quotes_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confectioner_quotes_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          }
        ]
      }
      confectioner_transactions: {
        Row: {
          id: string
          confectionerId: string
          type: string
          amount: number
          description: string | null
          orderId: string | null
          balanceAfter: number | null
          metadata: Json | null
          createdAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          type: string
          amount: number
          description?: string | null
          orderId?: string | null
          balanceAfter?: number | null
          metadata?: Json | null
          createdAt?: string
        }
        Update: {
          id?: string
          confectionerId?: string
          type?: string
          amount?: number
          description?: string | null
          orderId?: string | null
          balanceAfter?: number | null
          metadata?: Json | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      confectioners: {
        Row: {
          id: string
          userId: string
          businessName: string
          slug: string
          description: string
          avatar: string
          cover: string | null
          city: string
          location: Json
          rating: number
          reviewsCount: number
          ordersCount: number
          verified: boolean
          verificationStatus: string
          verifiedBy: string | null
          verifiedAt: string | null
          rejectionReason: string | null
          trustLevel: TrustLevel
          tariff: Tariff
          legalInfo: Json
          taxMode: TaxMode
          specialization: string[] | null
          portfolioImages: string[] | null
          followersCount: number
          responseTime: string
          joinedAt: string
          selfPickup: boolean
          deliveryOptions: string[] | null
          paymentSettings: Json | null
          ecoBadges: string[] | null
          balance: number
          totalEarnings: number
          monthlyEarnings: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          businessName: string
          slug: string
          description: string
          avatar: string
          cover?: string | null
          city: string
          location: Json
          rating?: number
          reviewsCount?: number
          ordersCount?: number
          verified?: boolean
          verificationStatus?: string
          verifiedBy?: string | null
          verifiedAt?: string | null
          rejectionReason?: string | null
          trustLevel?: TrustLevel
          tariff?: Tariff
          legalInfo: Json
          taxMode?: TaxMode
          specialization?: string[] | null
          portfolioImages?: string[] | null
          followersCount?: number
          responseTime?: string
          joinedAt?: string
          selfPickup?: boolean
          deliveryOptions?: string[] | null
          paymentSettings?: Json | null
          ecoBadges?: string[] | null
          balance?: number
          totalEarnings?: number
          monthlyEarnings?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          businessName?: string
          slug?: string
          description?: string
          avatar?: string
          cover?: string | null
          city?: string
          location?: Json
          rating?: number
          reviewsCount?: number
          ordersCount?: number
          verified?: boolean
          verificationStatus?: string
          verifiedBy?: string | null
          verifiedAt?: string | null
          rejectionReason?: string | null
          trustLevel?: TrustLevel
          tariff?: Tariff
          legalInfo?: Json
          taxMode?: TaxMode
          specialization?: string[] | null
          portfolioImages?: string[] | null
          followersCount?: number
          responseTime?: string
          joinedAt?: string
          selfPickup?: boolean
          deliveryOptions?: string[] | null
          paymentSettings?: Json | null
          ecoBadges?: string[] | null
          balance?: number
          totalEarnings?: number
          monthlyEarnings?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      configs: {
        Row: {
          id: string
          key: string
          value: string
          description: string | null
          category: string | null
          is_public: boolean | null
          updated_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          key: string
          value: string
          description?: string | null
          category?: string | null
          is_public?: boolean | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          key?: string
          value?: string
          description?: string | null
          category?: string | null
          is_public?: boolean | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      constructor_drafts: {
        Row: {
          id: string
          userId: string
          data: Json
          updatedAt: string
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          data: Json
          updatedAt: string
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          data?: Json
          updatedAt?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      content_reports: {
        Row: {
          id: string
          reporter_id: string
          content_type: string
          content_id: string
          reason: string
          description: string | null
          status: string
          resolved_by: string | null
          resolved_at: string | null
          resolution_comment: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          reporter_id: string
          content_type: string
          content_id: string
          reason: string
          description?: string | null
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_comment?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          reporter_id?: string
          content_type?: string
          content_id?: string
          reason?: string
          description?: string | null
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_comment?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      conversation_memories: {
        Row: {
          id: string
          customerId: string
          confectionerId: string
          chatRoomId: string | null
          orderId: string | null
          memoryType: string
          content: string
          confidence: number
          sourceMessageId: string | null
          sourceText: string | null
          confirmed: boolean
          isGlobal: boolean
          expiresAt: string | null
          createdAt: string
        }
        Insert: {
          id: string
          customerId: string
          confectionerId: string
          chatRoomId?: string | null
          orderId?: string | null
          memoryType: string
          content: string
          confidence?: number
          sourceMessageId?: string | null
          sourceText?: string | null
          confirmed?: boolean
          isGlobal?: boolean
          expiresAt?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          customerId?: string
          confectionerId?: string
          chatRoomId?: string | null
          orderId?: string | null
          memoryType?: string
          content?: string
          confidence?: number
          sourceMessageId?: string | null
          sourceText?: string | null
          confirmed?: boolean
          isGlobal?: boolean
          expiresAt?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      copywriter_profiles: {
        Row: {
          id: string
          userId: string
          skills: string[] | null
          articlesCount: number
          rating: number
          isActive: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          skills?: string[] | null
          articlesCount?: number
          rating?: number
          isActive?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          skills?: string[] | null
          articlesCount?: number
          rating?: number
          isActive?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      corporate_client_profiles: {
        Row: {
          id: string
          userId: string
          companyName: string
          inn: string | null
          budget: number
          contractStart: string | null
          contractEnd: string | null
          managerName: string | null
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          companyName: string
          inn?: string | null
          budget?: number
          contractStart?: string | null
          contractEnd?: string | null
          managerName?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          companyName?: string
          inn?: string | null
          budget?: number
          contractStart?: string | null
          contractEnd?: string | null
          managerName?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      courier_locations: {
        Row: {
          id: string
          courierId: string
          lat: number
          lng: number
          heading: number | null
          updatedAt: string
        }
        Insert: {
          id: string
          courierId: string
          lat: number
          lng: number
          heading?: number | null
          updatedAt: string
        }
        Update: {
          id?: string
          courierId?: string
          lat?: number
          lng?: number
          heading?: number | null
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      courier_profiles: {
        Row: {
          id: string
          userId: string
          transport: string
          availability: string[] | null
          region: string | null
          rating: number
          deliveriesCount: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          transport?: string
          availability?: string[] | null
          region?: string | null
          rating?: number
          deliveriesCount?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          transport?: string
          availability?: string[] | null
          region?: string | null
          rating?: number
          deliveriesCount?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      customer_interactions: {
        Row: {
          id: string
          user_id: string
          type: string
          description: string | null
          related_id: string | null
          related_type: string | null
          initiated_by: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          description?: string | null
          related_id?: string | null
          related_type?: string | null
          initiated_by?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          description?: string | null
          related_id?: string | null
          related_type?: string | null
          initiated_by?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      customer_profiles: {
        Row: {
          id: string
          userId: string
          loyaltyLevel: string
          bonusBalance: number
          preferences: Json | null
          totalOrders: number
          totalSpent: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          loyaltyLevel?: string
          bonusBalance?: number
          preferences?: Json | null
          totalOrders?: number
          totalSpent?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          loyaltyLevel?: string
          bonusBalance?: number
          preferences?: Json | null
          totalOrders?: number
          totalSpent?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      decor_items: {
        Row: {
          id: string
          name: string
          description: string | null
          type: string
          price_modifier: number | null
          is_active: boolean | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type?: string
          price_modifier?: number | null
          is_active?: boolean | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: string
          price_modifier?: number | null
          is_active?: boolean | null
          sort_order?: number | null
        }
        Relationships: [
        ]
      }
      deliveries: {
        Row: {
          id: string
          order_id: string
          courier_id: string | null
          status: string | null
          address: string
          lat: number | null
          lng: number | null
          pickup_at: string | null
          delivered_at: string | null
          estimated_time: string | null
          cost: number
          courier_earnings: number | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          courier_id?: string | null
          status?: string | null
          address: string
          lat?: number | null
          lng?: number | null
          pickup_at?: string | null
          delivered_at?: string | null
          estimated_time?: string | null
          cost?: number
          courier_earnings?: number | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          courier_id?: string | null
          status?: string | null
          address?: string
          lat?: number | null
          lng?: number | null
          pickup_at?: string | null
          delivered_at?: string | null
          estimated_time?: string | null
          cost?: number
          courier_earnings?: number | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      delivery_tracking: {
        Row: {
          id: string
          delivery_id: string | null
          order_id: string
          courier_id: string | null
          lat: number
          lng: number
          heading: number | null
          speed: number | null
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          delivery_id?: string | null
          order_id: string
          courier_id?: string | null
          lat: number
          lng: number
          heading?: number | null
          speed?: number | null
          status?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          delivery_id?: string | null
          order_id?: string
          courier_id?: string | null
          lat?: number
          lng?: number
          heading?: number | null
          speed?: number | null
          status?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tracking_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      delivery_zones: {
        Row: {
          id: string
          confectioner_id: string
          name: string
          cities: string[] | null
          delivery_price: number | null
          min_order_amount: number | null
          estimated_hours: number | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          confectioner_id: string
          name: string
          cities?: string[] | null
          delivery_price?: number | null
          min_order_amount?: number | null
          estimated_hours?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          confectioner_id?: string
          name?: string
          cities?: string[] | null
          delivery_price?: number | null
          min_order_amount?: number | null
          estimated_hours?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          }
        ]
      }
      design_settings: {
        Row: {
          id: string
          theme: string | null
          primary_color: string | null
          accent_color: string | null
          background_color: string | null
          text_color: string | null
          font_heading: string | null
          font_body: string | null
          layout_style: string | null
          max_width: number | null
          animations_enabled: boolean | null
          custom_css: string | null
          custom_js: string | null
          updated_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          theme?: string | null
          primary_color?: string | null
          accent_color?: string | null
          background_color?: string | null
          text_color?: string | null
          font_heading?: string | null
          font_body?: string | null
          layout_style?: string | null
          max_width?: number | null
          animations_enabled?: boolean | null
          custom_css?: string | null
          custom_js?: string | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          theme?: string | null
          primary_color?: string | null
          accent_color?: string | null
          background_color?: string | null
          text_color?: string | null
          font_heading?: string | null
          font_body?: string | null
          layout_style?: string | null
          max_width?: number | null
          animations_enabled?: boolean | null
          custom_css?: string | null
          custom_js?: string | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      email_messages: {
        Row: {
          id: string
          direction: string
          from_address: string
          from_name: string | null
          to_address: string
          to_name: string | null
          subject: string | null
          text_body: string | null
          html_body: string | null
          user_id: string | null
          order_id: string | null
          ticket_id: string | null
          lead_id: string | null
          template: string | null
          message_id: string | null
          in_reply_to: string | null
          status: string
          sent_at: string | null
          error_message: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          direction: string
          from_address: string
          from_name?: string | null
          to_address: string
          to_name?: string | null
          subject?: string | null
          text_body?: string | null
          html_body?: string | null
          user_id?: string | null
          order_id?: string | null
          ticket_id?: string | null
          lead_id?: string | null
          template?: string | null
          message_id?: string | null
          in_reply_to?: string | null
          status?: string
          sent_at?: string | null
          error_message?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          direction?: string
          from_address?: string
          from_name?: string | null
          to_address?: string
          to_name?: string | null
          subject?: string | null
          text_body?: string | null
          html_body?: string | null
          user_id?: string | null
          order_id?: string | null
          ticket_id?: string | null
          lead_id?: string | null
          template?: string | null
          message_id?: string | null
          in_reply_to?: string | null
          status?: string
          sent_at?: string | null
          error_message?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      escrow_accounts: {
        Row: {
          id: string
          order_id: string
          held_amount: number
          confectioner_amount: number
          platform_amount: number
          courier_amount: number
          partner_amount: number | null
          commission_rate: number | null
          status: string
          held_at: string | null
          released_at: string | null
          refunded_at: string | null
          release_scheduled_at: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          held_amount: number
          confectioner_amount?: number
          platform_amount?: number
          courier_amount?: number
          partner_amount?: number | null
          commission_rate?: number | null
          status?: string
          held_at?: string | null
          released_at?: string | null
          refunded_at?: string | null
          release_scheduled_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          held_amount?: number
          confectioner_amount?: number
          platform_amount?: number
          courier_amount?: number
          partner_amount?: number | null
          commission_rate?: number | null
          status?: string
          held_at?: string | null
          released_at?: string | null
          refunded_at?: string | null
          release_scheduled_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escrow_accounts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      event_organizer_profiles: {
        Row: {
          id: string
          userId: string
          agencyName: string
          inn: string | null
          eventsCount: number
          rating: number
          specialties: string[] | null
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          agencyName: string
          inn?: string | null
          eventsCount?: number
          rating?: number
          specialties?: string[] | null
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          agencyName?: string
          inn?: string | null
          eventsCount?: number
          rating?: number
          specialties?: string[] | null
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      favorite_confectioners: {
        Row: {
          id: string
          user_id: string
          confectioner_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          confectioner_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          confectioner_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "favorite_confectioners_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          }
        ]
      }
      fillings: {
        Row: {
          id: string
          name: string
          description: string | null
          base_sponge: string
          flavor_group: string
          dietary_tags: string[] | null
          price_multiplier: number | null
          is_seasonal: boolean | null
          season_months: number[] | null
          color_code: string | null
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          updated_at: string | null
          status: string
          created_by: string | null
          created_by_name: string | null
          usage_count: number
          admin_notes: string | null
          approved_by: string | null
          approved_at: string | null
          rejected_reason: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          base_sponge?: string
          flavor_group?: string
          dietary_tags?: string[] | null
          price_multiplier?: number | null
          is_seasonal?: boolean | null
          season_months?: number[] | null
          color_code?: string | null
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
          status?: string
          created_by?: string | null
          created_by_name?: string | null
          usage_count?: number
          admin_notes?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          base_sponge?: string
          flavor_group?: string
          dietary_tags?: string[] | null
          price_multiplier?: number | null
          is_seasonal?: boolean | null
          season_months?: number[] | null
          color_code?: string | null
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
          status?: string
          created_by?: string | null
          created_by_name?: string | null
          usage_count?: number
          admin_notes?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
        }
        Relationships: [
        ]
      }
      financial_audit_log: {
        Row: {
          id: string
          user_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          old_value: Json | null
          new_value: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          entity_type?: string | null
          entity_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      financial_audit_logs: {
        Row: {
          id: string
          userId: string | null
          action: string
          entity: string | null
          entityId: string | null
          amount: number | null
          description: string | null
          ip: string | null
          metadata: Json | null
          createdAt: string
        }
        Insert: {
          id: string
          userId?: string | null
          action: string
          entity?: string | null
          entityId?: string | null
          amount?: number | null
          description?: string | null
          ip?: string | null
          metadata?: Json | null
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string | null
          action?: string
          entity?: string | null
          entityId?: string | null
          amount?: number | null
          description?: string | null
          ip?: string | null
          metadata?: Json | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      food_service_profiles: {
        Row: {
          id: string
          userId: string
          venueName: string
          venueType: string
          seats: number
          address: string | null
          inn: string | null
          rating: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          venueName: string
          venueType?: string
          seats?: number
          address?: string | null
          inn?: string | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          venueName?: string
          venueType?: string
          seats?: number
          address?: string | null
          inn?: string | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      franchise_networks: {
        Row: {
          id: string
          franchiser_id: string
          name: string
          region: string | null
          description: string | null
          royalty_rate: number | null
          monthly_fee: number | null
          is_active: boolean | null
          contract_start: string | null
          contract_end: string | null
          total_confectioners: number | null
          total_sales: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          franchiser_id: string
          name: string
          region?: string | null
          description?: string | null
          royalty_rate?: number | null
          monthly_fee?: number | null
          is_active?: boolean | null
          contract_start?: string | null
          contract_end?: string | null
          total_confectioners?: number | null
          total_sales?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          franchiser_id?: string
          name?: string
          region?: string | null
          description?: string | null
          royalty_rate?: number | null
          monthly_fee?: number | null
          is_active?: boolean | null
          contract_start?: string | null
          contract_end?: string | null
          total_confectioners?: number | null
          total_sales?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      franchise_points: {
        Row: {
          id: string
          network_id: string
          confectioner_id: string
          status: string | null
          joined_at: string | null
          left_at: string | null
        }
        Insert: {
          id?: string
          network_id: string
          confectioner_id: string
          status?: string | null
          joined_at?: string | null
          left_at?: string | null
        }
        Update: {
          id?: string
          network_id?: string
          confectioner_id?: string
          status?: string | null
          joined_at?: string | null
          left_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "franchise_points_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "franchise_networks"
            referencedColumns: ["id"]
          }
        ]
      }
      franchisee_profiles: {
        Row: {
          id: string
          userId: string
          region: string
          royaltyRate: number
          startDate: string
          endDate: string | null
          status: string
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          region: string
          royaltyRate?: number
          startDate?: string
          endDate?: string | null
          status?: string
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          region?: string
          royaltyRate?: number
          startDate?: string
          endDate?: string | null
          status?: string
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      fraud_alerts: {
        Row: {
          id: string
          user_id: string | null
          order_id: string | null
          alert_type: string
          severity: string
          status: string
          trigger_rule: string | null
          trigger_data: Json | null
          risk_score: number | null
          ip_address: string | null
          user_agent: string | null
          description: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
          resolution: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          order_id?: string | null
          alert_type: string
          severity?: string
          status?: string
          trigger_rule?: string | null
          trigger_data?: Json | null
          risk_score?: number | null
          ip_address?: string | null
          user_agent?: string | null
          description?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          resolution?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          order_id?: string | null
          alert_type?: string
          severity?: string
          status?: string
          trigger_rule?: string | null
          trigger_data?: Json | null
          risk_score?: number | null
          ip_address?: string | null
          user_agent?: string | null
          description?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          resolution?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      fraud_log: {
        Row: {
          id: string
          user_id: string | null
          order_id: string | null
          event_type: string
          risk_score: number | null
          ip_address: string | null
          user_agent: string | null
          fingerprint: string | null
          details: Json | null
          triggered_rules: string[] | null
          is_blocked: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          order_id?: string | null
          event_type: string
          risk_score?: number | null
          ip_address?: string | null
          user_agent?: string | null
          fingerprint?: string | null
          details?: Json | null
          triggered_rules?: string[] | null
          is_blocked?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          order_id?: string | null
          event_type?: string
          risk_score?: number | null
          ip_address?: string | null
          user_agent?: string | null
          fingerprint?: string | null
          details?: Json | null
          triggered_rules?: string[] | null
          is_blocked?: boolean | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      gift_certificates: {
        Row: {
          id: string
          code: string
          purchaser_id: string
          recipient_email: string | null
          recipient_name: string | null
          amount: number
          status: string
          activated_at: string | null
          used_at: string | null
          expires_at: string | null
          payment_id: string | null
          applied_to_order_id: string | null
          pdf_url: string | null
          is_personalized: boolean | null
          message: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          code: string
          purchaser_id: string
          recipient_email?: string | null
          recipient_name?: string | null
          amount: number
          status?: string
          activated_at?: string | null
          used_at?: string | null
          expires_at?: string | null
          payment_id?: string | null
          applied_to_order_id?: string | null
          pdf_url?: string | null
          is_personalized?: boolean | null
          message?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          code?: string
          purchaser_id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          amount?: number
          status?: string
          activated_at?: string | null
          used_at?: string | null
          expires_at?: string | null
          payment_id?: string | null
          applied_to_order_id?: string | null
          pdf_url?: string | null
          is_personalized?: boolean | null
          message?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_certificates_applied_to_order_id_fkey"
            columns: ["applied_to_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_certificates_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          }
        ]
      }
      holiday_reminders: {
        Row: {
          id: string
          user_id: string
          name: string
          type: string
          date: string
          remind_days_before: number | null
          is_recurring: boolean | null
          last_notified_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          type: string
          date: string
          remind_days_before?: number | null
          is_recurring?: boolean | null
          last_notified_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          type?: string
          date?: string
          remind_days_before?: number | null
          is_recurring?: boolean | null
          last_notified_at?: string | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      holidays: {
        Row: {
          id: string
          name: string
          description: string | null
          holiday_type: string
          month: number | null
          day: number | null
          is_floating: boolean | null
          floating_calc: string | null
          region: string | null
          city: string | null
          category: string
          recommended_product_types: string[] | null
          icon: string | null
          is_seasonal: boolean | null
          season_months: number[] | null
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          holiday_type?: string
          month?: number | null
          day?: number | null
          is_floating?: boolean | null
          floating_calc?: string | null
          region?: string | null
          city?: string | null
          category?: string
          recommended_product_types?: string[] | null
          icon?: string | null
          is_seasonal?: boolean | null
          season_months?: number[] | null
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          holiday_type?: string
          month?: number | null
          day?: number | null
          is_floating?: boolean | null
          floating_calc?: string | null
          region?: string | null
          city?: string | null
          category?: string
          recommended_product_types?: string[] | null
          icon?: string | null
          is_seasonal?: boolean | null
          season_months?: number[] | null
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      image_processing_queue: {
        Row: {
          id: string
          mediaFileId: string
          status: string
          params: Json | null
          resultUrl: string | null
          error: string | null
          startedAt: string | null
          completedAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          mediaFileId: string
          status?: string
          params?: Json | null
          resultUrl?: string | null
          error?: string | null
          startedAt?: string | null
          completedAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          mediaFileId?: string
          status?: string
          params?: Json | null
          resultUrl?: string | null
          error?: string | null
          startedAt?: string | null
          completedAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      inquiries: {
        Row: {
          id: string
          user_id: string
          event_type: string | null
          base: string | null
          filling: string | null
          coating: string | null
          decorations: string[] | null
          dietary: string[] | null
          servings: number | null
          city: string | null
          delivery_date: string | null
          delivery_type: string | null
          inscription: string | null
          comment: string | null
          estimated_price: number | null
          status: string | null
          expires_at: string | null
          negotiations_count: number | null
          submitted_at: string | null
          closed_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          event_type?: string | null
          base?: string | null
          filling?: string | null
          coating?: string | null
          decorations?: string[] | null
          dietary?: string[] | null
          servings?: number | null
          city?: string | null
          delivery_date?: string | null
          delivery_type?: string | null
          inscription?: string | null
          comment?: string | null
          estimated_price?: number | null
          status?: string | null
          expires_at?: string | null
          negotiations_count?: number | null
          submitted_at?: string | null
          closed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          event_type?: string | null
          base?: string | null
          filling?: string | null
          coating?: string | null
          decorations?: string[] | null
          dietary?: string[] | null
          servings?: number | null
          city?: string | null
          delivery_date?: string | null
          delivery_type?: string | null
          inscription?: string | null
          comment?: string | null
          estimated_price?: number | null
          status?: string | null
          expires_at?: string | null
          negotiations_count?: number | null
          submitted_at?: string | null
          closed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      insurance_contributions: {
        Row: {
          id: string
          confectionerId: string
          amount: number
          period: string
          type: string
          status: string
          paidAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          amount: number
          period: string
          type?: string
          status?: string
          paidAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          confectionerId?: string
          amount?: number
          period?: string
          type?: string
          status?: string
          paidAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      inventory_items: {
        Row: {
          id: string
          owner_id: string
          name: string
          category: string | null
          quantity: number | null
          unit: string | null
          min_quantity: number | null
          cost_per_unit: number | null
          supplier: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          category?: string | null
          quantity?: number | null
          unit?: string | null
          min_quantity?: number | null
          cost_per_unit?: number | null
          supplier?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          category?: string | null
          quantity?: number | null
          unit?: string | null
          min_quantity?: number | null
          cost_per_unit?: number | null
          supplier?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      lead_activities: {
        Row: {
          id: string
          lead_id: string
          user_id: string
          type: string
          description: string | null
          outcome: string | null
          scheduled_at: string | null
          completed_at: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          lead_id: string
          user_id: string
          type: string
          description?: string | null
          outcome?: string | null
          scheduled_at?: string | null
          completed_at?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          lead_id?: string
          user_id?: string
          type?: string
          description?: string | null
          outcome?: string | null
          scheduled_at?: string | null
          completed_at?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          }
        ]
      }
      leads: {
        Row: {
          id: string
          source: string
          name: string
          email: string | null
          phone: string | null
          company: string | null
          inquiry: string | null
          budget: number | null
          event_date: string | null
          city: string | null
          status: string
          stage: string | null
          assigned_to: string | null
          metadata: Json | null
          contacted_at: string | null
          qualified_at: string | null
          won_at: string | null
          lost_at: string | null
          lost_reason: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          source?: string
          name: string
          email?: string | null
          phone?: string | null
          company?: string | null
          inquiry?: string | null
          budget?: number | null
          event_date?: string | null
          city?: string | null
          status?: string
          stage?: string | null
          assigned_to?: string | null
          metadata?: Json | null
          contacted_at?: string | null
          qualified_at?: string | null
          won_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          source?: string
          name?: string
          email?: string | null
          phone?: string | null
          company?: string | null
          inquiry?: string | null
          budget?: number | null
          event_date?: string | null
          city?: string | null
          status?: string
          stage?: string | null
          assigned_to?: string | null
          metadata?: Json | null
          contacted_at?: string | null
          qualified_at?: string | null
          won_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      lesson_enrollments: {
        Row: {
          id: string
          lesson_id: string
          user_id: string
          status: string | null
          payment_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          lesson_id: string
          user_id: string
          status?: string | null
          payment_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          lesson_id?: string
          user_id?: string
          status?: string | null
          payment_id?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_enrollments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_enrollments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          }
        ]
      }
      lessons: {
        Row: {
          id: string
          confectioner_id: string
          atelier_id: string | null
          title: string
          description: string | null
          topic: string | null
          difficulty: string | null
          duration_minutes: number | null
          max_participants: number | null
          price: number
          scheduled_at: string
          status: string | null
          image_url: string | null
          enrolled_count: number | null
          rating: number | null
          reviews_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          confectioner_id: string
          atelier_id?: string | null
          title: string
          description?: string | null
          topic?: string | null
          difficulty?: string | null
          duration_minutes?: number | null
          max_participants?: number | null
          price: number
          scheduled_at: string
          status?: string | null
          image_url?: string | null
          enrolled_count?: number | null
          rating?: number | null
          reviews_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          confectioner_id?: string
          atelier_id?: string | null
          title?: string
          description?: string | null
          topic?: string | null
          difficulty?: string | null
          duration_minutes?: number | null
          max_participants?: number | null
          price?: number
          scheduled_at?: string
          status?: string | null
          image_url?: string | null
          enrolled_count?: number | null
          rating?: number | null
          reviews_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_atelier_id_fkey"
            columns: ["atelier_id"]
            isOneToOne: false
            referencedRelation: "ateliers"
            referencedColumns: ["id"]
          }
        ]
      }
      live_stream_messages: {
        Row: {
          id: string
          streamId: string
          userId: string | null
          sessionId: string | null
          userName: string
          userAvatar: string | null
          text: string
          pinned: boolean
          deleted: boolean
          createdAt: string
        }
        Insert: {
          id: string
          streamId: string
          userId?: string | null
          sessionId?: string | null
          userName: string
          userAvatar?: string | null
          text: string
          pinned?: boolean
          deleted?: boolean
          createdAt?: string
        }
        Update: {
          id?: string
          streamId?: string
          userId?: string | null
          sessionId?: string | null
          userName?: string
          userAvatar?: string | null
          text?: string
          pinned?: boolean
          deleted?: boolean
          createdAt?: string
        }
        Relationships: [
        ]
      }
      live_stream_orders: {
        Row: {
          id: string
          streamId: string
          orderId: string
          userId: string
          createdAt: string
        }
        Insert: {
          id: string
          streamId: string
          orderId: string
          userId: string
          createdAt?: string
        }
        Update: {
          id?: string
          streamId?: string
          orderId?: string
          userId?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      live_stream_viewers: {
        Row: {
          id: string
          streamId: string
          userId: string | null
          sessionId: string | null
          joinedAt: string
          leftAt: string | null
          watchTime: number
          liked: boolean
          ordered: boolean
        }
        Insert: {
          id: string
          streamId: string
          userId?: string | null
          sessionId?: string | null
          joinedAt?: string
          leftAt?: string | null
          watchTime?: number
          liked?: boolean
          ordered?: boolean
        }
        Update: {
          id?: string
          streamId?: string
          userId?: string | null
          sessionId?: string | null
          joinedAt?: string
          leftAt?: string | null
          watchTime?: number
          liked?: boolean
          ordered?: boolean
        }
        Relationships: [
        ]
      }
      live_streams: {
        Row: {
          id: string
          confectionerId: string
          title: string
          description: string | null
          thumbnailUrl: string | null
          status: string
          streamUrl: string | null
          streamKey: string | null
          productId: string | null
          viewersCount: number
          peakViewers: number
          totalViewers: number
          likesCount: number
          ordersCount: number
          revenue: number
          recordUrl: string | null
          scheduledAt: string | null
          startedAt: string | null
          endedAt: string | null
          createdAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          title: string
          description?: string | null
          thumbnailUrl?: string | null
          status?: string
          streamUrl?: string | null
          streamKey?: string | null
          productId?: string | null
          viewersCount?: number
          peakViewers?: number
          totalViewers?: number
          likesCount?: number
          ordersCount?: number
          revenue?: number
          recordUrl?: string | null
          scheduledAt?: string | null
          startedAt?: string | null
          endedAt?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          confectionerId?: string
          title?: string
          description?: string | null
          thumbnailUrl?: string | null
          status?: string
          streamUrl?: string | null
          streamKey?: string | null
          productId?: string | null
          viewersCount?: number
          peakViewers?: number
          totalViewers?: number
          likesCount?: number
          ordersCount?: number
          revenue?: number
          recordUrl?: string | null
          scheduledAt?: string | null
          startedAt?: string | null
          endedAt?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      loyalty_cross_actions: {
        Row: {
          id: string
          partner_id: string
          title: string
          description: string
          discount_type: string
          discount_value: number
          start_at: string
          end_at: string
          usage_limit: number | null
          usage_count: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          partner_id: string
          title: string
          description: string
          discount_type: string
          discount_value: number
          start_at: string
          end_at: string
          usage_limit?: number | null
          usage_count?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          partner_id?: string
          title?: string
          description?: string
          discount_type?: string
          discount_value?: number
          start_at?: string
          end_at?: string
          usage_limit?: number | null
          usage_count?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_cross_actions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "loyalty_partners"
            referencedColumns: ["id"]
          }
        ]
      }
      loyalty_partners: {
        Row: {
          id: string
          user_id: string | null
          company_name: string
          company_type: string
          inn: string | null
          legal_address: string | null
          contact_email: string
          contact_phone: string | null
          api_key_hash: string | null
          api_key_scopes: Json | null
          is_verified: boolean
          is_active: boolean
          partnership_started_at: string
          partnership_ended_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          company_name: string
          company_type: string
          inn?: string | null
          legal_address?: string | null
          contact_email: string
          contact_phone?: string | null
          api_key_hash?: string | null
          api_key_scopes?: Json | null
          is_verified?: boolean
          is_active?: boolean
          partnership_started_at?: string
          partnership_ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          company_name?: string
          company_type?: string
          inn?: string | null
          legal_address?: string | null
          contact_email?: string
          contact_phone?: string | null
          api_key_hash?: string | null
          api_key_scopes?: Json | null
          is_verified?: boolean
          is_active?: boolean
          partnership_started_at?: string
          partnership_ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      loyalty_point_exchanges: {
        Row: {
          id: string
          user_id: string
          partner_id: string
          direction: string
          points_amount: number
          external_txn_id: string | null
          status: string
          external_payload: Json | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          partner_id: string
          direction: string
          points_amount: number
          external_txn_id?: string | null
          status: string
          external_payload?: Json | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          partner_id?: string
          direction?: string
          points_amount?: number
          external_txn_id?: string | null
          status?: string
          external_payload?: Json | null
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_point_exchanges_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "loyalty_partners"
            referencedColumns: ["id"]
          }
        ]
      }
      loyalty_transactions: {
        Row: {
          id: string
          user_id: string
          type: string
          amount: number
          order_id: string | null
          expires_at: string | null
          description: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          amount: number
          order_id?: string | null
          expires_at?: string | null
          description?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          amount?: number
          order_id?: string | null
          expires_at?: string | null
          description?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      maintenance_log: {
        Row: {
          id: string
          type: string
          status: string | null
          started_at: string | null
          finished_at: string | null
          duration_ms: number | null
          records_affected: number | null
          backup_path: string | null
          backup_size_bytes: number | null
          error: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          type: string
          status?: string | null
          started_at?: string | null
          finished_at?: string | null
          duration_ms?: number | null
          records_affected?: number | null
          backup_path?: string | null
          backup_size_bytes?: number | null
          error?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          type?: string
          status?: string | null
          started_at?: string | null
          finished_at?: string | null
          duration_ms?: number | null
          records_affected?: number | null
          backup_path?: string | null
          backup_size_bytes?: number | null
          error?: string | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      maintenance_logs: {
        Row: {
          id: string
          type: MaintenanceType
          status: MaintenanceStatus
          startedAt: string
          finishedAt: string | null
          durationMs: number | null
          recordsAffected: number | null
          backupPath: string | null
          backupSizeBytes: number | null
          tablesCount: number | null
          details: Json | null
          errorMessage: string | null
          triggeredBy: string | null
          createdAt: string
        }
        Insert: {
          id: string
          type: MaintenanceType
          status?: MaintenanceStatus
          startedAt?: string
          finishedAt?: string | null
          durationMs?: number | null
          recordsAffected?: number | null
          backupPath?: string | null
          backupSizeBytes?: number | null
          tablesCount?: number | null
          details?: Json | null
          errorMessage?: string | null
          triggeredBy?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          type?: MaintenanceType
          status?: MaintenanceStatus
          startedAt?: string
          finishedAt?: string | null
          durationMs?: number | null
          recordsAffected?: number | null
          backupPath?: string | null
          backupSizeBytes?: number | null
          tablesCount?: number | null
          details?: Json | null
          errorMessage?: string | null
          triggeredBy?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      media_files: {
        Row: {
          id: string
          url: string
          type: string
          size: number
          filename: string | null
          mimeType: string | null
          width: number | null
          height: number | null
          alt: string | null
          uploadedBy: string | null
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          url: string
          type: string
          size?: number
          filename?: string | null
          mimeType?: string | null
          width?: number | null
          height?: number | null
          alt?: string | null
          uploadedBy?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          url?: string
          type?: string
          size?: number
          filename?: string | null
          mimeType?: string | null
          width?: number | null
          height?: number | null
          alt?: string | null
          uploadedBy?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      message_attachments: {
        Row: {
          id: string
          messageId: string
          url: string
          type: string
          size: number
          filename: string | null
          mimeType: string | null
          createdAt: string
        }
        Insert: {
          id: string
          messageId: string
          url: string
          type: string
          size?: number
          filename?: string | null
          mimeType?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          messageId?: string
          url?: string
          type?: string
          size?: number
          filename?: string | null
          mimeType?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      message_reactions: {
        Row: {
          id: string
          messageId: string
          userId: string
          emoji: string
          createdAt: string
        }
        Insert: {
          id: string
          messageId: string
          userId: string
          emoji: string
          createdAt?: string
        }
        Update: {
          id?: string
          messageId?: string
          userId?: string
          emoji?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      message_reports: {
        Row: {
          id: string
          messageId: string
          reporterId: string
          reason: string
          details: string | null
          status: string
          resolvedBy: string | null
          resolvedAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          messageId: string
          reporterId: string
          reason: string
          details?: string | null
          status?: string
          resolvedBy?: string | null
          resolvedAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          messageId?: string
          reporterId?: string
          reason?: string
          details?: string | null
          status?: string
          resolvedBy?: string | null
          resolvedAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      moderation_queue: {
        Row: {
          id: string
          content_type: string
          content_id: string
          author_id: string | null
          auto_status: string | null
          auto_reason: string | null
          flagged_keywords: string[] | null
          manual_status: string | null
          moderated_by: string | null
          moderated_at: string | null
          moderation_comment: string | null
          content_snapshot: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          content_type: string
          content_id: string
          author_id?: string | null
          auto_status?: string | null
          auto_reason?: string | null
          flagged_keywords?: string[] | null
          manual_status?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          moderation_comment?: string | null
          content_snapshot?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          content_type?: string
          content_id?: string
          author_id?: string | null
          auto_status?: string | null
          auto_reason?: string | null
          flagged_keywords?: string[] | null
          manual_status?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          moderation_comment?: string | null
          content_snapshot?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      moderation_reports: {
        Row: {
          id: string
          item_id: string
          item_type: string
          reason: string
          description: string | null
          reporter_id: string | null
          reporter_name: string | null
          reporter_ip: string | null
          status: string
          moderator_id: string | null
          moderator_notes: string | null
          resolved_at: string | null
          resolution: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          item_id: string
          item_type: string
          reason: string
          description?: string | null
          reporter_id?: string | null
          reporter_name?: string | null
          reporter_ip?: string | null
          status?: string
          moderator_id?: string | null
          moderator_notes?: string | null
          resolved_at?: string | null
          resolution?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          item_id?: string
          item_type?: string
          reason?: string
          description?: string | null
          reporter_id?: string | null
          reporter_name?: string | null
          reporter_ip?: string | null
          status?: string
          moderator_id?: string | null
          moderator_notes?: string | null
          resolved_at?: string | null
          resolution?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      moderation_rules: {
        Row: {
          id: string
          type: string
          pattern: string
          action: string
          category: string | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          type: string
          pattern: string
          action?: string
          category?: string | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          type?: string
          pattern?: string
          action?: string
          category?: string | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      moderator_profiles: {
        Row: {
          id: string
          userId: string
          permissions: string[] | null
          casesCount: number
          rating: number
          isActive: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          permissions?: string[] | null
          casesCount?: number
          rating?: number
          isActive?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          permissions?: string[] | null
          casesCount?: number
          rating?: number
          isActive?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      nav_menu_items: {
        Row: {
          id: string
          label: string
          link: string
          icon: string | null
          sortOrder: number
          isActive: boolean
          isDropdown: boolean
          parentId: string | null
          createdAt: string
        }
        Insert: {
          id: string
          label: string
          link: string
          icon?: string | null
          sortOrder?: number
          isActive?: boolean
          isDropdown?: boolean
          parentId?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          label?: string
          link?: string
          icon?: string | null
          sortOrder?: number
          isActive?: boolean
          isDropdown?: boolean
          parentId?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      negotiation_messages: {
        Row: {
          id: string
          negotiation_id: string
          sender_id: string
          text: string
          attachments: Json | null
          is_system: boolean | null
          created_at: string | null
          read_at: string | null
        }
        Insert: {
          id?: string
          negotiation_id: string
          sender_id: string
          text: string
          attachments?: Json | null
          is_system?: boolean | null
          created_at?: string | null
          read_at?: string | null
        }
        Update: {
          id?: string
          negotiation_id?: string
          sender_id?: string
          text?: string
          attachments?: Json | null
          is_system?: boolean | null
          created_at?: string | null
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_messages_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          }
        ]
      }
      negotiation_revisions: {
        Row: {
          id: string
          negotiation_id: string
          quoted_price: number | null
          quoted_delivery_cost: number | null
          quoted_prep_time: string | null
          quoted_items: Json | null
          discount_percent: number | null
          discount_comment: string | null
          changed_by: string
          change_reason: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          negotiation_id: string
          quoted_price?: number | null
          quoted_delivery_cost?: number | null
          quoted_prep_time?: string | null
          quoted_items?: Json | null
          discount_percent?: number | null
          discount_comment?: string | null
          changed_by: string
          change_reason?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          negotiation_id?: string
          quoted_price?: number | null
          quoted_delivery_cost?: number | null
          quoted_prep_time?: string | null
          quoted_items?: Json | null
          discount_percent?: number | null
          discount_comment?: string | null
          changed_by?: string
          change_reason?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_revisions_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          }
        ]
      }
      negotiations: {
        Row: {
          id: string
          inquiry_id: string
          user_id: string
          confectioner_id: string
          quoted_price: number | null
          quoted_delivery_cost: number | null
          quoted_prep_time: string | null
          quoted_items: Json | null
          discount_requested: boolean | null
          discount_percent: number | null
          discount_comment: string | null
          status: string | null
          expires_at: string | null
          quoted_at: string | null
          accepted_at: string | null
          declined_at: string | null
          order_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          inquiry_id: string
          user_id: string
          confectioner_id: string
          quoted_price?: number | null
          quoted_delivery_cost?: number | null
          quoted_prep_time?: string | null
          quoted_items?: Json | null
          discount_requested?: boolean | null
          discount_percent?: number | null
          discount_comment?: string | null
          status?: string | null
          expires_at?: string | null
          quoted_at?: string | null
          accepted_at?: string | null
          declined_at?: string | null
          order_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          inquiry_id?: string
          user_id?: string
          confectioner_id?: string
          quoted_price?: number | null
          quoted_delivery_cost?: number | null
          quoted_prep_time?: string | null
          quoted_items?: Json | null
          discount_requested?: boolean | null
          discount_percent?: number | null
          discount_comment?: string | null
          status?: string | null
          expires_at?: string | null
          quoted_at?: string | null
          accepted_at?: string | null
          declined_at?: string | null
          order_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiations_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      notification_preferences: {
        Row: {
          user_id: string
          email_enabled: boolean | null
          push_enabled: boolean | null
          telegram_enabled: boolean | null
          sms_enabled: boolean | null
          in_app_enabled: boolean | null
          order_created: boolean | null
          order_status_changed: boolean | null
          order_delivered: boolean | null
          new_message: boolean | null
          promotions: boolean | null
          weekly_digest: boolean | null
          updated_at: string | null
        }
        Insert: {
          user_id: string
          email_enabled?: boolean | null
          push_enabled?: boolean | null
          telegram_enabled?: boolean | null
          sms_enabled?: boolean | null
          in_app_enabled?: boolean | null
          order_created?: boolean | null
          order_status_changed?: boolean | null
          order_delivered?: boolean | null
          new_message?: boolean | null
          promotions?: boolean | null
          weekly_digest?: boolean | null
          updated_at?: string | null
        }
        Update: {
          user_id?: string
          email_enabled?: boolean | null
          push_enabled?: boolean | null
          telegram_enabled?: boolean | null
          sms_enabled?: boolean | null
          in_app_enabled?: boolean | null
          order_created?: boolean | null
          order_status_changed?: boolean | null
          order_delivered?: boolean | null
          new_message?: boolean | null
          promotions?: boolean | null
          weekly_digest?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string | null
          channel: string | null
          status: string | null
          metadata: Json | null
          read_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          body?: string | null
          channel?: string | null
          status?: string | null
          metadata?: Json | null
          read_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          body?: string | null
          channel?: string | null
          status?: string | null
          metadata?: Json | null
          read_at?: string | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      nutritionist_profiles: {
        Row: {
          id: string
          userId: string
          specializations: string[] | null
          certificates: Json | null
          rating: number
          consultationsCount: number
          isActive: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          specializations?: string[] | null
          certificates?: Json | null
          rating?: number
          consultationsCount?: number
          isActive?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          specializations?: string[] | null
          certificates?: Json | null
          rating?: number
          consultationsCount?: number
          isActive?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      operator_escalations: {
        Row: {
          id: string
          ticket_id: string
          operator_id: string
          reason: string
          priority: string | null
          status: string | null
          resolved_by: string | null
          resolved_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          ticket_id: string
          operator_id: string
          reason: string
          priority?: string | null
          status?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          ticket_id?: string
          operator_id?: string
          reason?: string
          priority?: string | null
          status?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_escalations_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          }
        ]
      }
      order_fraud_logs: {
        Row: {
          id: string
          ipHash: string
          deviceFp: string | null
          userId: string | null
          orderId: string | null
          action: string
          createdAt: string
        }
        Insert: {
          id: string
          ipHash: string
          deviceFp?: string | null
          userId?: string | null
          orderId?: string | null
          action: string
          createdAt?: string
        }
        Update: {
          id?: string
          ipHash?: string
          deviceFp?: string | null
          userId?: string | null
          orderId?: string | null
          action?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_title: string
          product_image: string | null
          unit_price: number
          quantity: number
          selected_attributes: Json | null
          total: number
          created_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          product_title: string
          product_image?: string | null
          unit_price: number
          quantity?: number
          selected_attributes?: Json | null
          total: number
          created_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string | null
          product_title?: string
          product_image?: string | null
          unit_price?: number
          quantity?: number
          selected_attributes?: Json | null
          total?: number
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      order_negotiations: {
        Row: {
          id: string
          orderId: string
          confectionerId: string
          proposedPrice: number
          originalPrice: number | null
          message: string | null
          status: string
          expiresAt: string | null
          resolvedAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          orderId: string
          confectionerId: string
          proposedPrice: number
          originalPrice?: number | null
          message?: string | null
          status?: string
          expiresAt?: string | null
          resolvedAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          orderId?: string
          confectionerId?: string
          proposedPrice?: number
          originalPrice?: number | null
          message?: string | null
          status?: string
          expiresAt?: string | null
          resolvedAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      order_status_history: {
        Row: {
          id: string
          order_id: string
          status_from: string | null
          status_to: string
          changed_by: string | null
          comment: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          status_from?: string | null
          status_to: string
          changed_by?: string | null
          comment?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          status_from?: string | null
          status_to?: string
          changed_by?: string | null
          comment?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      order_tracking: {
        Row: {
          id: string
          orderId: string
          courierId: string | null
          lat: number
          lng: number
          heading: number | null
          speed: number | null
          timestamp: string
        }
        Insert: {
          id: string
          orderId: string
          courierId?: string | null
          lat: number
          lng: number
          heading?: number | null
          speed?: number | null
          timestamp?: string
        }
        Update: {
          id?: string
          orderId?: string
          courierId?: string | null
          lat?: number
          lng?: number
          heading?: number | null
          speed?: number | null
          timestamp?: string
        }
        Relationships: [
        ]
      }
      orders: {
        Row: {
          id: string
          number: string
          user_id: string
          confectioner_id: string | null
          subtotal: number
          delivery_cost: number | null
          discount: number | null
          total: number
          status: order_status | null
          type: string | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_postal_code: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_type: string | null
          delivery_date: string | null
          delivery_time_window: string | null
          notes: string | null
          metadata: Json | null
          confirmed_at: string | null
          paid_at: string | null
          shipped_at: string | null
          delivered_at: string | null
          completed_at: string | null
          cancelled_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          number: string
          user_id: string
          confectioner_id?: string | null
          subtotal: number
          delivery_cost?: number | null
          discount?: number | null
          total: number
          status?: order_status | null
          type?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_postal_code?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_type?: string | null
          delivery_date?: string | null
          delivery_time_window?: string | null
          notes?: string | null
          metadata?: Json | null
          confirmed_at?: string | null
          paid_at?: string | null
          shipped_at?: string | null
          delivered_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          number?: string
          user_id?: string
          confectioner_id?: string | null
          subtotal?: number
          delivery_cost?: number | null
          discount?: number | null
          total?: number
          status?: order_status | null
          type?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_postal_code?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_type?: string | null
          delivery_date?: string | null
          delivery_time_window?: string | null
          notes?: string | null
          metadata?: Json | null
          confirmed_at?: string | null
          paid_at?: string | null
          shipped_at?: string | null
          delivered_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      organization_verifications: {
        Row: {
          id: string
          user_id: string | null
          inn: string
          ogrn: string | null
          kpp: string | null
          company_name: string | null
          full_name: string | null
          opf_code: string | null
          opf_short: string | null
          status: string | null
          trigger: string | null
          verified_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          inn: string
          ogrn?: string | null
          kpp?: string | null
          company_name?: string | null
          full_name?: string | null
          opf_code?: string | null
          opf_short?: string | null
          status?: string | null
          trigger?: string | null
          verified_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          inn?: string
          ogrn?: string | null
          kpp?: string | null
          company_name?: string | null
          full_name?: string | null
          opf_code?: string | null
          opf_short?: string | null
          status?: string | null
          trigger?: string | null
          verified_at?: string | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      payments: {
        Row: {
          id: string
          order_id: string
          yookassa_payment_id: string | null
          yookassa_status: string | null
          amount: number
          currency: string | null
          status: payment_status | null
          method: payment_method | null
          escrow_released_at: string | null
          refund_amount: number | null
          refund_reason: string | null
          refunded_at: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          order_id: string
          yookassa_payment_id?: string | null
          yookassa_status?: string | null
          amount: number
          currency?: string | null
          status?: payment_status | null
          method?: payment_method | null
          escrow_released_at?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          yookassa_payment_id?: string | null
          yookassa_status?: string | null
          amount?: number
          currency?: string | null
          status?: payment_status | null
          method?: payment_method | null
          escrow_released_at?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      payout_requests: {
        Row: {
          id: string
          user_id: string
          amount: number
          status: string
          method: string | null
          bank_details: Json | null
          processed_by: string | null
          processed_at: string | null
          payment_id: string | null
          rejection_reason: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          status?: string
          method?: string | null
          bank_details?: Json | null
          processed_by?: string | null
          processed_at?: string | null
          payment_id?: string | null
          rejection_reason?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          status?: string
          method?: string | null
          bank_details?: Json | null
          processed_by?: string | null
          processed_at?: string | null
          payment_id?: string | null
          rejection_reason?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      payouts: {
        Row: {
          id: string
          confectioner_id: string
          amount: number
          currency: string
          status: string
          method: string
          destination: Json
          transaction_id: string | null
          provider: string | null
          fee_amount: number | null
          net_amount: number
          requested_at: string
          processed_at: string | null
          completed_at: string | null
          error_message: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          confectioner_id: string
          amount: number
          currency?: string
          status?: string
          method?: string
          destination: Json
          transaction_id?: string | null
          provider?: string | null
          fee_amount?: number | null
          net_amount: number
          requested_at?: string
          processed_at?: string | null
          completed_at?: string | null
          error_message?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          confectioner_id?: string
          amount?: number
          currency?: string
          status?: string
          method?: string
          destination?: Json
          transaction_id?: string | null
          provider?: string | null
          fee_amount?: number | null
          net_amount?: number
          requested_at?: string
          processed_at?: string | null
          completed_at?: string | null
          error_message?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      permissions: {
        Row: {
          id: string
          name: string
          slug: string
          module: string
          description: string | null
          is_system: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          module: string
          description?: string | null
          is_system?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          module?: string
          description?: string | null
          is_system?: boolean | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      pickup_point_profiles: {
        Row: {
          id: string
          userId: string
          address: string
          storageType: string
          capacity: number
          workingHours: string | null
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          address: string
          storageType?: string
          capacity?: number
          workingHours?: string | null
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          address?: string
          storageType?: string
          capacity?: number
          workingHours?: string | null
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      price_inquiries: {
        Row: {
          id: string
          userId: string
          draftId: string | null
          confectionerIds: string[] | null
          message: string | null
          status: string
          responsesCount: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          draftId?: string | null
          confectionerIds?: string[] | null
          message?: string | null
          status?: string
          responsesCount?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          draftId?: string | null
          confectionerIds?: string[] | null
          message?: string | null
          status?: string
          responsesCount?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      product_attributes: {
        Row: {
          id: string
          product_id: string
          name: string
          value: string
          price_modifier: number | null
          sort_order: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          name: string
          value: string
          price_modifier?: number | null
          sort_order?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          name?: string
          value?: string
          price_modifier?: number | null
          sort_order?: number | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      product_categories: {
        Row: {
          id: string
          slug: string
          name: string
          icon: string | null
          description: string | null
          parent_id: string | null
          group_name: string | null
          link: string | null
          sort_order: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          slug: string
          name: string
          icon?: string | null
          description?: string | null
          parent_id?: string | null
          group_name?: string | null
          link?: string | null
          sort_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          icon?: string | null
          description?: string | null
          parent_id?: string | null
          group_name?: string | null
          link?: string | null
          sort_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          }
        ]
      }
      product_favorites: {
        Row: {
          id: string
          user_id: string
          product_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          product_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          product_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      product_images: {
        Row: {
          id: string
          product_id: string
          url: string
          alt_text: string | null
          sort_order: number | null
          is_primary: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          url: string
          alt_text?: string | null
          sort_order?: number | null
          is_primary?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          url?: string
          alt_text?: string | null
          sort_order?: number | null
          is_primary?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      product_reviews: {
        Row: {
          id: string
          product_id: string
          user_id: string
          rating: number
          text: string | null
          pros: string | null
          cons: string | null
          status: string | null
          moderated_by: string | null
          moderated_at: string | null
          helpful_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          user_id: string
          rating: number
          text?: string | null
          pros?: string | null
          cons?: string | null
          status?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          helpful_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          user_id?: string
          rating?: number
          text?: string | null
          pros?: string | null
          cons?: string | null
          status?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          helpful_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      product_slices: {
        Row: {
          id: string
          productId: string
          fillingName: string
          image: string | null
          config: Json | null
          caption: string | null
          sortOrder: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          productId: string
          fillingName: string
          image?: string | null
          config?: Json | null
          caption?: string | null
          sortOrder?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          productId?: string
          fillingName?: string
          image?: string | null
          config?: Json | null
          caption?: string | null
          sortOrder?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      product_variants: {
        Row: {
          id: string
          product_id: string
          name: string
          weight_grams: number | null
          price_modifier: number | null
          sku: string | null
          in_stock: boolean | null
          is_default: boolean | null
          sort_order: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          name: string
          weight_grams?: number | null
          price_modifier?: number | null
          sku?: string | null
          in_stock?: boolean | null
          is_default?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          name?: string
          weight_grams?: number | null
          price_modifier?: number | null
          sku?: string | null
          in_stock?: boolean | null
          is_default?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      product_videos: {
        Row: {
          id: string
          product_id: string
          video_url: string
          poster_url: string | null
          title: string | null
          description: string | null
          duration_seconds: number | null
          is_primary: boolean | null
          sort_order: number | null
          status: string | null
          views_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          video_url: string
          poster_url?: string | null
          title?: string | null
          description?: string | null
          duration_seconds?: number | null
          is_primary?: boolean | null
          sort_order?: number | null
          status?: string | null
          views_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          video_url?: string
          poster_url?: string | null
          title?: string | null
          description?: string | null
          duration_seconds?: number | null
          is_primary?: boolean | null
          sort_order?: number | null
          status?: string | null
          views_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_videos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      products: {
        Row: {
          id: string
          confectioner_id: string
          category_id: string | null
          slug: string
          title: string
          description: string | null
          long_description: string | null
          price: number
          old_price: number | null
          currency: string | null
          weight_grams: number | null
          servings: number | null
          tags: string[] | null
          dietary_features: string[] | null
          status: string | null
          is_featured: boolean | null
          views_count: number | null
          sales_count: number | null
          rating_average: number | null
          reviews_count: number | null
          published_at: string | null
          created_at: string | null
          updated_at: string | null
          deleted_at: string | null
          search_vector: unknown | null
        }
        Insert: {
          id?: string
          confectioner_id: string
          category_id?: string | null
          slug: string
          title: string
          description?: string | null
          long_description?: string | null
          price: number
          old_price?: number | null
          currency?: string | null
          weight_grams?: number | null
          servings?: number | null
          tags?: string[] | null
          dietary_features?: string[] | null
          status?: string | null
          is_featured?: boolean | null
          views_count?: number | null
          sales_count?: number | null
          rating_average?: number | null
          reviews_count?: number | null
          published_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
          search_vector?: unknown | null
        }
        Update: {
          id?: string
          confectioner_id?: string
          category_id?: string | null
          slug?: string
          title?: string
          description?: string | null
          long_description?: string | null
          price?: number
          old_price?: number | null
          currency?: string | null
          weight_grams?: number | null
          servings?: number | null
          tags?: string[] | null
          dietary_features?: string[] | null
          status?: string | null
          is_featured?: boolean | null
          views_count?: number | null
          sales_count?: number | null
          rating_average?: number | null
          reviews_count?: number | null
          published_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
          search_vector?: unknown | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          id: string
          email: string
          name: string | null
          phone: string | null
          avatar_url: string | null
          bio: string | null
          city: string | null
          is_blocked: boolean | null
          blocked_reason: string | null
          blocked_at: string | null
          loyalty_level: loyalty_level | null
          bonus_balance: number | null
          account_type: account_type | null
          default_delivery_address: string | null
          dietary_restrictions: string[] | null
          allergens: string[] | null
          preferred_payment_method: string | null
          birth_date: string | null
          created_at: string | null
          updated_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id: string
          email: string
          name?: string | null
          phone?: string | null
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          is_blocked?: boolean | null
          blocked_reason?: string | null
          blocked_at?: string | null
          loyalty_level?: loyalty_level | null
          bonus_balance?: number | null
          account_type?: account_type | null
          default_delivery_address?: string | null
          dietary_restrictions?: string[] | null
          allergens?: string[] | null
          preferred_payment_method?: string | null
          birth_date?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          phone?: string | null
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          is_blocked?: boolean | null
          blocked_reason?: string | null
          blocked_at?: string | null
          loyalty_level?: loyalty_level | null
          bonus_balance?: number | null
          account_type?: account_type | null
          default_delivery_address?: string | null
          dietary_restrictions?: string[] | null
          allergens?: string[] | null
          preferred_payment_method?: string | null
          birth_date?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
        ]
      }
      promo_campaigns: {
        Row: {
          id: string
          code: string
          name: string
          description: string | null
          discountType: string
          value: number
          startDate: string
          endDate: string | null
          maxUses: number | null
          usedCount: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          code: string
          name: string
          description?: string | null
          discountType?: string
          value?: number
          startDate?: string
          endDate?: string | null
          maxUses?: number | null
          usedCount?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          description?: string | null
          discountType?: string
          value?: number
          startDate?: string
          endDate?: string | null
          maxUses?: number | null
          usedCount?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      promo_code_usages: {
        Row: {
          id: string
          promo_code_id: string
          user_id: string
          order_id: string | null
          discount_amount: number
          created_at: string | null
        }
        Insert: {
          id?: string
          promo_code_id: string
          user_id: string
          order_id?: string | null
          discount_amount: number
          created_at?: string | null
        }
        Update: {
          id?: string
          promo_code_id?: string
          user_id?: string
          order_id?: string | null
          discount_amount?: number
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_usages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_usages_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          }
        ]
      }
      promo_codes: {
        Row: {
          id: string
          code: string
          description: string | null
          type: string
          value: number
          min_order_amount: number | null
          max_uses: number | null
          used_count: number | null
          valid_from: string | null
          valid_to: string | null
          applies_to: string | null
          target_id: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          code: string
          description?: string | null
          type?: string
          value?: number
          min_order_amount?: number | null
          max_uses?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_to?: string | null
          applies_to?: string | null
          target_id?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          code?: string
          description?: string | null
          type?: string
          value?: number
          min_order_amount?: number | null
          max_uses?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_to?: string | null
          applies_to?: string | null
          target_id?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      promotions: {
        Row: {
          id: string
          confectionerId: string
          title: string
          description: string
          type: string
          value: number | null
          promoCode: string | null
          minOrderAmount: number | null
          startDate: string
          endDate: string
          cities: string[] | null
          status: string
          isPromoted: boolean
          promotedUntil: string | null
          promotionBudget: number | null
          image: string | null
          views: number
          clicks: number
          conversions: number
          usedCount: number
          createdAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          title: string
          description: string
          type: string
          value?: number | null
          promoCode?: string | null
          minOrderAmount?: number | null
          startDate: string
          endDate: string
          cities?: string[] | null
          status?: string
          isPromoted?: boolean
          promotedUntil?: string | null
          promotionBudget?: number | null
          image?: string | null
          views?: number
          clicks?: number
          conversions?: number
          usedCount?: number
          createdAt?: string
        }
        Update: {
          id?: string
          confectionerId?: string
          title?: string
          description?: string
          type?: string
          value?: number | null
          promoCode?: string | null
          minOrderAmount?: number | null
          startDate?: string
          endDate?: string
          cities?: string[] | null
          status?: string
          isPromoted?: boolean
          promotedUntil?: string | null
          promotionBudget?: number | null
          image?: string | null
          views?: number
          clicks?: number
          conversions?: number
          usedCount?: number
          createdAt?: string
        }
        Relationships: [
        ]
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          keys: Json
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          keys: Json
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          keys?: Json
          is_active?: boolean | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      quality_inspector_profiles: {
        Row: {
          id: string
          userId: string
          certificates: Json | null
          inspectionsCount: number
          rating: number
          region: string | null
          isActive: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          certificates?: Json | null
          inspectionsCount?: number
          rating?: number
          region?: string | null
          isActive?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          certificates?: Json | null
          inspectionsCount?: number
          rating?: number
          region?: string | null
          isActive?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      quote_requests: {
        Row: {
          id: string
          customer_id: string | null
          customer_name: string | null
          customer_avatar: string | null
          product_type: string | null
          product_type_label: string | null
          event_type: string | null
          base: string | null
          filling: string | null
          filling_id: string | null
          coating: string | null
          decorations: string[] | null
          dietary: string[] | null
          servings: number | null
          quantity: number | null
          tiers: number | null
          shape: string | null
          inscription: string | null
          comment: string | null
          city: string
          delivery_date: string | null
          delivery_type: string | null
          address: string | null
          discount_requested: boolean | null
          discount_percent: number | null
          discount_comment: string | null
          estimated_price: number
          estimated_delivery_cost: number
          confectioner_ids: string[]
          status: string
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_avatar?: string | null
          product_type?: string | null
          product_type_label?: string | null
          event_type?: string | null
          base?: string | null
          filling?: string | null
          filling_id?: string | null
          coating?: string | null
          decorations?: string[] | null
          dietary?: string[] | null
          servings?: number | null
          quantity?: number | null
          tiers?: number | null
          shape?: string | null
          inscription?: string | null
          comment?: string | null
          city: string
          delivery_date?: string | null
          delivery_type?: string | null
          address?: string | null
          discount_requested?: boolean | null
          discount_percent?: number | null
          discount_comment?: string | null
          estimated_price?: number
          estimated_delivery_cost?: number
          confectioner_ids?: string[]
          status?: string
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_avatar?: string | null
          product_type?: string | null
          product_type_label?: string | null
          event_type?: string | null
          base?: string | null
          filling?: string | null
          filling_id?: string | null
          coating?: string | null
          decorations?: string[] | null
          dietary?: string[] | null
          servings?: number | null
          quantity?: number | null
          tiers?: number | null
          shape?: string | null
          inscription?: string | null
          comment?: string | null
          city?: string
          delivery_date?: string | null
          delivery_type?: string | null
          address?: string | null
          discount_requested?: boolean | null
          discount_percent?: number | null
          discount_comment?: string | null
          estimated_price?: number
          estimated_delivery_cost?: number
          confectioner_ids?: string[]
          status?: string
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      recipe_acceptances: {
        Row: {
          id: string
          recipe_id: string
          user_id: string
          rating: number | null
          comment: string | null
          photo_url: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          recipe_id: string
          user_id: string
          rating?: number | null
          comment?: string | null
          photo_url?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          recipe_id?: string
          user_id?: string
          rating?: number | null
          comment?: string | null
          photo_url?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_acceptances_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          }
        ]
      }
      recipe_marketplace: {
        Row: {
          id: string
          author_id: string
          title: string
          slug: string
          description: string
          base_price: number
          is_premium: boolean
          premium_price: number | null
          royalty_rate: number
          cooking_time_min: number | null
          difficulty: number | null
          tags: string[] | null
          preview_image: string | null
          steps_json: Json
          ingredients_json: Json
          views: number
          purchases_count: number
          rating: number
          is_published: boolean
          published_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          author_id: string
          title: string
          slug: string
          description: string
          base_price?: number
          is_premium?: boolean
          premium_price?: number | null
          royalty_rate?: number
          cooking_time_min?: number | null
          difficulty?: number | null
          tags?: string[] | null
          preview_image?: string | null
          steps_json: Json
          ingredients_json: Json
          views?: number
          purchases_count?: number
          rating?: number
          is_published?: boolean
          published_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          author_id?: string
          title?: string
          slug?: string
          description?: string
          base_price?: number
          is_premium?: boolean
          premium_price?: number | null
          royalty_rate?: number
          cooking_time_min?: number | null
          difficulty?: number | null
          tags?: string[] | null
          preview_image?: string | null
          steps_json?: Json
          ingredients_json?: Json
          views?: number
          purchases_count?: number
          rating?: number
          is_published?: boolean
          published_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      recipe_purchases: {
        Row: {
          id: string
          recipe_id: string
          buyer_id: string
          price_paid: number
          royalty_amount: number
          commission_amount: number
          payment_id: string | null
          is_active: boolean
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          recipe_id: string
          buyer_id: string
          price_paid: number
          royalty_amount: number
          commission_amount: number
          payment_id?: string | null
          is_active?: boolean
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          recipe_id?: string
          buyer_id?: string
          price_paid?: number
          royalty_amount?: number
          commission_amount?: number
          payment_id?: string | null
          is_active?: boolean
          expires_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_purchases_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_marketplace"
            referencedColumns: ["id"]
          }
        ]
      }
      recipe_subscriptions: {
        Row: {
          id: string
          subscriber_id: string
          author_id: string
          price_per_month: number
          status: string
          current_period_start: string
          current_period_end: string
          next_renewal_at: string | null
          cancelled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          subscriber_id: string
          author_id: string
          price_per_month: number
          status: string
          current_period_start?: string
          current_period_end: string
          next_renewal_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          subscriber_id?: string
          author_id?: string
          price_per_month?: number
          status?: string
          current_period_start?: string
          current_period_end?: string
          next_renewal_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      recipes: {
        Row: {
          id: string
          author_id: string
          title: string
          description: string | null
          content: string
          difficulty: string | null
          prep_time_minutes: number | null
          cook_time_minutes: number | null
          servings: number | null
          calories_per_serving: number | null
          protein_g: number | null
          fat_g: number | null
          carb_g: number | null
          tags: string[] | null
          category: string | null
          image_url: string | null
          video_url: string | null
          slug: string | null
          status: string | null
          views_count: number | null
          likes_count: number | null
          published_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          author_id: string
          title: string
          description?: string | null
          content: string
          difficulty?: string | null
          prep_time_minutes?: number | null
          cook_time_minutes?: number | null
          servings?: number | null
          calories_per_serving?: number | null
          protein_g?: number | null
          fat_g?: number | null
          carb_g?: number | null
          tags?: string[] | null
          category?: string | null
          image_url?: string | null
          video_url?: string | null
          slug?: string | null
          status?: string | null
          views_count?: number | null
          likes_count?: number | null
          published_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          author_id?: string
          title?: string
          description?: string | null
          content?: string
          difficulty?: string | null
          prep_time_minutes?: number | null
          cook_time_minutes?: number | null
          servings?: number | null
          calories_per_serving?: number | null
          protein_g?: number | null
          fat_g?: number | null
          carb_g?: number | null
          tags?: string[] | null
          category?: string | null
          image_url?: string | null
          video_url?: string | null
          slug?: string | null
          status?: string | null
          views_count?: number | null
          likes_count?: number | null
          published_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      recurring_orders: {
        Row: {
          id: string
          customerId: string
          supplierId: string
          schedule: string
          items: Json
          nextRunAt: string | null
          status: string
          lastRunAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          customerId: string
          supplierId: string
          schedule: string
          items: Json
          nextRunAt?: string | null
          status?: string
          lastRunAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          customerId?: string
          supplierId?: string
          schedule?: string
          items?: Json
          nextRunAt?: string | null
          status?: string
          lastRunAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      referrals: {
        Row: {
          id: string
          userId: string
          referralCode: string
          totalInvited: number
          activeReferrals: number
          totalEarned: number
          availableBalance: number
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          referralCode: string
          totalInvited?: number
          activeReferrals?: number
          totalEarned?: number
          availableBalance?: number
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          referralCode?: string
          totalInvited?: number
          activeReferrals?: number
          totalEarned?: number
          availableBalance?: number
          createdAt?: string
        }
        Relationships: [
        ]
      }
      refresh_tokens: {
        Row: {
          id: string
          userId: string
          token: string
          expiresAt: string
          revokedAt: string | null
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          token: string
          expiresAt: string
          revokedAt?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          token?: string
          expiresAt?: string
          revokedAt?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      refunds: {
        Row: {
          id: string
          payment_id: string
          order_id: string
          amount: number
          reason: string | null
          status: string
          initiated_by: string
          yookassa_refund_id: string | null
          processed_by: string | null
          processed_at: string | null
          rejection_reason: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          payment_id: string
          order_id: string
          amount: number
          reason?: string | null
          status?: string
          initiated_by: string
          yookassa_refund_id?: string | null
          processed_by?: string | null
          processed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          payment_id?: string
          order_id?: string
          amount?: number
          reason?: string | null
          status?: string
          initiated_by?: string
          yookassa_refund_id?: string | null
          processed_by?: string | null
          processed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          }
        ]
      }
      relationship_contexts: {
        Row: {
          id: string
          customerId: string
          confectionerId: string
          ordersCount: number
          chatsCount: number
          relationshipType: string
          preferences: Json | null
          communicationStyle: Json | null
          keyFacts: Json | null
          lastOrderId: string | null
          lastOrderDate: string | null
          trustScore: number
          avgRating: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          customerId: string
          confectionerId: string
          ordersCount?: number
          chatsCount?: number
          relationshipType?: string
          preferences?: Json | null
          communicationStyle?: Json | null
          keyFacts?: Json | null
          lastOrderId?: string | null
          lastOrderDate?: string | null
          trustScore?: number
          avgRating?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          customerId?: string
          confectionerId?: string
          ordersCount?: number
          chatsCount?: number
          relationshipType?: string
          preferences?: Json | null
          communicationStyle?: Json | null
          keyFacts?: Json | null
          lastOrderId?: string | null
          lastOrderDate?: string | null
          trustScore?: number
          avgRating?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      repeat_order_templates: {
        Row: {
          id: string
          user_id: string
          order_id: string
          name: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          order_id: string
          name?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          order_id?: string
          name?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repeat_order_templates_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      reviews: {
        Row: {
          id: string
          productId: string
          userId: string
          rating: number
          text: string
          images: string[] | null
          createdAt: string
        }
        Insert: {
          id: string
          productId: string
          userId: string
          rating: number
          text: string
          images?: string[] | null
          createdAt?: string
        }
        Update: {
          id?: string
          productId?: string
          userId?: string
          rating?: number
          text?: string
          images?: string[] | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      role_permissions: {
        Row: {
          id: string
          role: string
          permission_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          role: string
          permission_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          role?: string
          permission_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          }
        ]
      }
      royalty_payments: {
        Row: {
          id: string
          network_id: string
          period_month: string
          total_sales: number
          royalty_rate: number
          royalty_amount: number
          status: string
          paid_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          network_id: string
          period_month: string
          total_sales?: number
          royalty_rate: number
          royalty_amount?: number
          status?: string
          paid_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          network_id?: string
          period_month?: string
          total_sales?: number
          royalty_rate?: number
          royalty_amount?: number
          status?: string
          paid_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "royalty_payments_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "franchise_networks"
            referencedColumns: ["id"]
          }
        ]
      }
      scheduled_jobs: {
        Row: {
          id: string
          name: string
          description: string | null
          type: string
          function_name: string | null
          sql_query: string | null
          cron_expression: string
          timezone: string | null
          is_active: boolean | null
          last_run_at: string | null
          next_run_at: string | null
          runs_count: number | null
          success_count: number | null
          failure_count: number | null
          last_error: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type: string
          function_name?: string | null
          sql_query?: string | null
          cron_expression: string
          timezone?: string | null
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          runs_count?: number | null
          success_count?: number | null
          failure_count?: number | null
          last_error?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: string
          function_name?: string | null
          sql_query?: string | null
          cron_expression?: string
          timezone?: string | null
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          runs_count?: number | null
          success_count?: number | null
          failure_count?: number | null
          last_error?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      semaphores: {
        Row: {
          id: string
          type: string
          value: string
          userId: string
          verified: boolean
          attempts: number
          createdAt: string
        }
        Insert: {
          id: string
          type: string
          value: string
          userId: string
          verified?: boolean
          attempts?: number
          createdAt?: string
        }
        Update: {
          id?: string
          type?: string
          value?: string
          userId?: string
          verified?: boolean
          attempts?: number
          createdAt?: string
        }
        Relationships: [
        ]
      }
      sessions: {
        Row: {
          id: string
          userId: string
          token: string
          ip: string | null
          userAgent: string | null
          expiresAt: string
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          token: string
          ip?: string | null
          userAgent?: string | null
          expiresAt: string
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          token?: string
          ip?: string | null
          userAgent?: string | null
          expiresAt?: string
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      simplex_contacts: {
        Row: {
          id: string
          userId: string
          simplexConnId: string | null
          simplexAddress: string | null
          simplexName: string | null
          profileType: string
          active: boolean
          connectionsCount: number
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          simplexConnId?: string | null
          simplexAddress?: string | null
          simplexName?: string | null
          profileType?: string
          active?: boolean
          connectionsCount?: number
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          simplexConnId?: string | null
          simplexAddress?: string | null
          simplexName?: string | null
          profileType?: string
          active?: boolean
          connectionsCount?: number
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      simplex_messages: {
        Row: {
          id: string
          simplexContactId: string
          simplexChatId: string
          simplexMsgId: string
          fromName: string | null
          text: string | null
          metadata: Json | null
          direction: string
          readByOperator: boolean
          orderId: string | null
          receivedAt: string
        }
        Insert: {
          id: string
          simplexContactId: string
          simplexChatId: string
          simplexMsgId: string
          fromName?: string | null
          text?: string | null
          metadata?: Json | null
          direction?: string
          readByOperator?: boolean
          orderId?: string | null
          receivedAt?: string
        }
        Update: {
          id?: string
          simplexContactId?: string
          simplexChatId?: string
          simplexMsgId?: string
          fromName?: string | null
          text?: string | null
          metadata?: Json | null
          direction?: string
          readByOperator?: boolean
          orderId?: string | null
          receivedAt?: string
        }
        Relationships: [
        ]
      }
      site_settings: {
        Row: {
          id: string
          key: string
          value: string
          category: string
          description: string | null
          updatedAt: string
          updatedBy: string | null
        }
        Insert: {
          id: string
          key: string
          value: string
          category?: string
          description?: string | null
          updatedAt: string
          updatedBy?: string | null
        }
        Update: {
          id?: string
          key?: string
          value?: string
          category?: string
          description?: string | null
          updatedAt?: string
          updatedBy?: string | null
        }
        Relationships: [
        ]
      }
      split_payments: {
        Row: {
          id: string
          payment_id: string
          order_id: string
          confectioner_id: string | null
          courier_id: string | null
          partner_id: string | null
          total_amount: number
          confectioner_amount: number
          platform_amount: number
          courier_amount: number | null
          partner_amount: number | null
          commission_rate: number | null
          status: string
          processed_at: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          payment_id: string
          order_id: string
          confectioner_id?: string | null
          courier_id?: string | null
          partner_id?: string | null
          total_amount: number
          confectioner_amount?: number
          platform_amount?: number
          courier_amount?: number | null
          partner_amount?: number | null
          commission_rate?: number | null
          status?: string
          processed_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          payment_id?: string
          order_id?: string
          confectioner_id?: string | null
          courier_id?: string | null
          partner_id?: string | null
          total_amount?: number
          confectioner_amount?: number
          platform_amount?: number
          courier_amount?: number | null
          partner_amount?: number | null
          commission_rate?: number | null
          status?: string
          processed_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "split_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "split_payments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          }
        ]
      }
      stock_movements: {
        Row: {
          id: string
          inventory_id: string
          type: string
          quantity: number
          reason: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          inventory_id: string
          type: string
          quantity: number
          reason?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          inventory_id?: string
          type?: string
          quantity?: number
          reason?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          }
        ]
      }
      story_likes: {
        Row: {
          id: string
          storyId: string
          userId: string
          createdAt: string
        }
        Insert: {
          id: string
          storyId: string
          userId: string
          createdAt?: string
        }
        Update: {
          id?: string
          storyId?: string
          userId?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      story_replies: {
        Row: {
          id: string
          storyId: string
          userId: string
          text: string
          createdAt: string
        }
        Insert: {
          id: string
          storyId: string
          userId: string
          text: string
          createdAt?: string
        }
        Update: {
          id?: string
          storyId?: string
          userId?: string
          text?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      studio_profiles: {
        Row: {
          id: string
          userId: string
          studioName: string
          teamSize: number
          description: string | null
          specialties: string[] | null
          rating: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          studioName: string
          teamSize?: number
          description?: string | null
          specialties?: string[] | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          studioName?: string
          teamSize?: number
          description?: string | null
          specialties?: string[] | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          type: string
          product_template: Json | null
          next_delivery_date: string
          delivery_day_of_week: number | null
          status: string
          paused_until: string | null
          price_per_delivery: number
          discount_percent: number | null
          total_deliveries: number | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type?: string
          product_template?: Json | null
          next_delivery_date: string
          delivery_day_of_week?: number | null
          status?: string
          paused_until?: string | null
          price_per_delivery: number
          discount_percent?: number | null
          total_deliveries?: number | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          product_template?: Json | null
          next_delivery_date?: string
          delivery_day_of_week?: number | null
          status?: string
          paused_until?: string | null
          price_per_delivery?: number
          discount_percent?: number | null
          total_deliveries?: number | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      supplier_products: {
        Row: {
          id: string
          supplier_id: string
          product_name: string
          sku: string | null
          category: string | null
          description: string | null
          unit: string
          quantity: number
          min_stock: number
          max_stock: number | null
          price: number
          cost_price: number | null
          currency: string
          image_url: string | null
          is_active: boolean
          last_restocked_at: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          supplier_id: string
          product_name: string
          sku?: string | null
          category?: string | null
          description?: string | null
          unit?: string
          quantity?: number
          min_stock?: number
          max_stock?: number | null
          price?: number
          cost_price?: number | null
          currency?: string
          image_url?: string | null
          is_active?: boolean
          last_restocked_at?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          supplier_id?: string
          product_name?: string
          sku?: string | null
          category?: string | null
          description?: string | null
          unit?: string
          quantity?: number
          min_stock?: number
          max_stock?: number | null
          price?: number
          cost_price?: number | null
          currency?: string
          image_url?: string | null
          is_active?: boolean
          last_restocked_at?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      supplier_profiles: {
        Row: {
          id: string
          userId: string
          companyName: string
          inn: string | null
          deliveryTerms: string | null
          minOrderAmount: number
          regions: string[] | null
          rating: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          companyName: string
          inn?: string | null
          deliveryTerms?: string | null
          minOrderAmount?: number
          regions?: string[] | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          companyName?: string
          inn?: string | null
          deliveryTerms?: string | null
          minOrderAmount?: number
          regions?: string[] | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      support_tickets: {
        Row: {
          id: string
          number: string
          user_id: string
          assigned_to: string | null
          subject: string
          category: string
          priority: string
          status: string
          order_id: string | null
          messages_count: number | null
          first_response_at: string | null
          resolved_at: string | null
          closed_at: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          number: string
          user_id: string
          assigned_to?: string | null
          subject: string
          category?: string
          priority?: string
          status?: string
          order_id?: string | null
          messages_count?: number | null
          first_response_at?: string | null
          resolved_at?: string | null
          closed_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          number?: string
          user_id?: string
          assigned_to?: string | null
          subject?: string
          category?: string
          priority?: string
          status?: string
          order_id?: string | null
          messages_count?: number | null
          first_response_at?: string | null
          resolved_at?: string | null
          closed_at?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      taster_profiles: {
        Row: {
          id: string
          userId: string
          certificates: Json | null
          rating: number
          reviewsCount: number
          specialties: string[] | null
          isActive: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          certificates?: Json | null
          rating?: number
          reviewsCount?: number
          specialties?: string[] | null
          isActive?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          certificates?: Json | null
          rating?: number
          reviewsCount?: number
          specialties?: string[] | null
          isActive?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      tasting_bookings: {
        Row: {
          id: string
          tasting_id: string
          user_id: string
          participants_count: number | null
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tasting_id: string
          user_id: string
          participants_count?: number | null
          status?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tasting_id?: string
          user_id?: string
          participants_count?: number | null
          status?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasting_bookings_tasting_id_fkey"
            columns: ["tasting_id"]
            isOneToOne: false
            referencedRelation: "tastings"
            referencedColumns: ["id"]
          }
        ]
      }
      tastings: {
        Row: {
          id: string
          atelier_id: string
          date: string
          start_time: string
          end_time: string
          max_participants: number | null
          current_participants: number | null
          price: number | null
          status: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          atelier_id: string
          date: string
          start_time: string
          end_time: string
          max_participants?: number | null
          current_participants?: number | null
          price?: number | null
          status?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          atelier_id?: string
          date?: string
          start_time?: string
          end_time?: string
          max_participants?: number | null
          current_participants?: number | null
          price?: number | null
          status?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tastings_atelier_id_fkey"
            columns: ["atelier_id"]
            isOneToOne: false
            referencedRelation: "ateliers"
            referencedColumns: ["id"]
          }
        ]
      }
      tax_reports: {
        Row: {
          id: string
          confectionerId: string
          period: string
          income: number
          expenses: number
          tax: number
          taxMode: string | null
          status: string
          filedAt: string | null
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          period: string
          income?: number
          expenses?: number
          tax?: number
          taxMode?: string | null
          status?: string
          filedAt?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          confectionerId?: string
          period?: string
          income?: number
          expenses?: number
          tax?: number
          taxMode?: string | null
          status?: string
          filedAt?: string | null
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      team_activity_logs: {
        Row: {
          id: string
          teamId: string
          userId: string | null
          action: string
          entity: string | null
          entityId: string | null
          metadata: Json | null
          createdAt: string
        }
        Insert: {
          id: string
          teamId: string
          userId?: string | null
          action: string
          entity?: string | null
          entityId?: string | null
          metadata?: Json | null
          createdAt?: string
        }
        Update: {
          id?: string
          teamId?: string
          userId?: string | null
          action?: string
          entity?: string | null
          entityId?: string | null
          metadata?: Json | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      team_events: {
        Row: {
          id: string
          teamId: string
          title: string
          description: string | null
          date: string
          location: string | null
          durationMin: number
          createdBy: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          teamId: string
          title: string
          description?: string | null
          date: string
          location?: string | null
          durationMin?: number
          createdBy?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          teamId?: string
          title?: string
          description?: string | null
          date?: string
          location?: string | null
          durationMin?: number
          createdBy?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      team_invitations: {
        Row: {
          id: string
          teamId: string
          email: string
          token: string
          role: string
          status: string
          invitedBy: string | null
          expiresAt: string
          acceptedAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          teamId: string
          email: string
          token: string
          role?: string
          status?: string
          invitedBy?: string | null
          expiresAt: string
          acceptedAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          teamId?: string
          email?: string
          token?: string
          role?: string
          status?: string
          invitedBy?: string | null
          expiresAt?: string
          acceptedAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      team_members: {
        Row: {
          id: string
          teamId: string
          userId: string
          role: string
          joinedAt: string
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          teamId: string
          userId: string
          role?: string
          joinedAt?: string
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          teamId?: string
          userId?: string
          role?: string
          joinedAt?: string
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      team_tasks: {
        Row: {
          id: string
          teamId: string
          title: string
          description: string | null
          status: string
          priority: string
          assigneeId: string | null
          dueDate: string | null
          completedAt: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          teamId: string
          title: string
          description?: string | null
          status?: string
          priority?: string
          assigneeId?: string | null
          dueDate?: string | null
          completedAt?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          teamId?: string
          title?: string
          description?: string | null
          status?: string
          priority?: string
          assigneeId?: string | null
          dueDate?: string | null
          completedAt?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      tender_invitations: {
        Row: {
          id: string
          tender_id: string
          confectioner_id: string
          status: string | null
          invited_at: string | null
          responded_at: string | null
        }
        Insert: {
          id?: string
          tender_id: string
          confectioner_id: string
          status?: string | null
          invited_at?: string | null
          responded_at?: string | null
        }
        Update: {
          id?: string
          tender_id?: string
          confectioner_id?: string
          status?: string | null
          invited_at?: string | null
          responded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_invitations_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_invitations_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          }
        ]
      }
      tender_offers: {
        Row: {
          id: string
          tender_id: string
          confectioner_id: string
          offer_price: number
          offer_description: string | null
          proposed_delivery_date: string | null
          proposed_items: Json | null
          status: string
          is_winner: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tender_id: string
          confectioner_id: string
          offer_price: number
          offer_description?: string | null
          proposed_delivery_date?: string | null
          proposed_items?: Json | null
          status?: string
          is_winner?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tender_id?: string
          confectioner_id?: string
          offer_price?: number
          offer_description?: string | null
          proposed_delivery_date?: string | null
          proposed_items?: Json | null
          status?: string
          is_winner?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_offers_confectioner_id_fkey"
            columns: ["confectioner_id"]
            isOneToOne: false
            referencedRelation: "confectioners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_offers_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          }
        ]
      }
      tender_reviews: {
        Row: {
          id: string
          tender_id: string
          reviewer_id: string
          target_user_id: string
          rating: number
          comment: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tender_id: string
          reviewer_id: string
          target_user_id: string
          rating: number
          comment?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tender_id?: string
          reviewer_id?: string
          target_user_id?: string
          rating?: number
          comment?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_reviews_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          }
        ]
      }
      tenders: {
        Row: {
          id: string
          customer_id: string
          title: string
          description: string | null
          category: string | null
          required_servings: number | null
          budget_min: number | null
          budget_max: number | null
          required_city: string | null
          required_delivery_date: string | null
          end_date: string
          specifications: Json | null
          status: string
          is_public: boolean | null
          is_urgent: boolean | null
          chat_channel_id: string | null
          offers_count: number | null
          views_count: number | null
          awarded_at: string | null
          closed_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          customer_id: string
          title: string
          description?: string | null
          category?: string | null
          required_servings?: number | null
          budget_min?: number | null
          budget_max?: number | null
          required_city?: string | null
          required_delivery_date?: string | null
          end_date: string
          specifications?: Json | null
          status?: string
          is_public?: boolean | null
          is_urgent?: boolean | null
          chat_channel_id?: string | null
          offers_count?: number | null
          views_count?: number | null
          awarded_at?: string | null
          closed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          customer_id?: string
          title?: string
          description?: string | null
          category?: string | null
          required_servings?: number | null
          budget_min?: number | null
          budget_max?: number | null
          required_city?: string | null
          required_delivery_date?: string | null
          end_date?: string
          specifications?: Json | null
          status?: string
          is_public?: boolean | null
          is_urgent?: boolean | null
          chat_channel_id?: string | null
          offers_count?: number | null
          views_count?: number | null
          awarded_at?: string | null
          closed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      ticket_messages: {
        Row: {
          id: string
          ticket_id: string
          sender_id: string
          text: string
          attachments: Json | null
          is_internal: boolean | null
          is_system: boolean | null
          created_at: string | null
          read_at: string | null
        }
        Insert: {
          id?: string
          ticket_id: string
          sender_id: string
          text: string
          attachments?: Json | null
          is_internal?: boolean | null
          is_system?: boolean | null
          created_at?: string | null
          read_at?: string | null
        }
        Update: {
          id?: string
          ticket_id?: string
          sender_id?: string
          text?: string
          attachments?: Json | null
          is_internal?: boolean | null
          is_system?: boolean | null
          created_at?: string | null
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          }
        ]
      }
      two_factor_challenges: {
        Row: {
          id: string
          userId: string
          operation: string
          codeHash: string
          attempts: number
          resolved: boolean
          expiresAt: string
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          operation: string
          codeHash: string
          attempts?: number
          resolved?: boolean
          expiresAt: string
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          operation?: string
          codeHash?: string
          attempts?: number
          resolved?: boolean
          expiresAt?: string
          createdAt?: string
        }
        Relationships: [
        ]
      }
      uploads: {
        Row: {
          id: string
          filename: string
          original_name: string | null
          url: string
          thumb_url: string | null
          mime_type: string | null
          size_bytes: number | null
          original_size_bytes: number | null
          category: string
          uploaded_by: string | null
          has_watermark: boolean | null
          created_at: string | null
          metadata: Json | null
        }
        Insert: {
          id?: string
          filename: string
          original_name?: string | null
          url: string
          thumb_url?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          original_size_bytes?: number | null
          category?: string
          uploaded_by?: string | null
          has_watermark?: boolean | null
          created_at?: string | null
          metadata?: Json | null
        }
        Update: {
          id?: string
          filename?: string
          original_name?: string | null
          url?: string
          thumb_url?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          original_size_bytes?: number | null
          category?: string
          uploaded_by?: string | null
          has_watermark?: boolean | null
          created_at?: string | null
          metadata?: Json | null
        }
        Relationships: [
        ]
      }
      user_badges: {
        Row: {
          id: string
          user_id: string
          badge_id: string
          awarded_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          badge_id: string
          awarded_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          badge_id?: string
          awarded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          }
        ]
      }
      user_challenges: {
        Row: {
          id: string
          user_id: string
          challenge_id: string
          progress: number | null
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          challenge_id: string
          progress?: number | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          challenge_id?: string
          progress?: number | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_challenges_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          }
        ]
      }
      user_holidays: {
        Row: {
          id: string
          userId: string
          title: string
          type: string
          date: string
          recurring: boolean
          personName: string | null
          relationship: string | null
          reminderDays: number
          notes: string | null
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          title: string
          type?: string
          date: string
          recurring?: boolean
          personName?: string | null
          relationship?: string | null
          reminderDays?: number
          notes?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          title?: string
          type?: string
          date?: string
          recurring?: boolean
          personName?: string | null
          relationship?: string | null
          reminderDays?: number
          notes?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: user_role
          is_active: boolean | null
          assigned_at: string | null
          assigned_by: string | null
          deactivated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          role: user_role
          is_active?: boolean | null
          assigned_at?: string | null
          assigned_by?: string | null
          deactivated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          role?: user_role
          is_active?: boolean | null
          assigned_at?: string | null
          assigned_by?: string | null
          deactivated_at?: string | null
        }
        Relationships: [
        ]
      }
      users: {
        Row: {
          id: string
          email: string
          passwordHash: string
          name: string
          phone: string | null
          avatar: string | null
          roles: UserRole[] | null
          accountType: AccountType
          legalInfo: Json | null
          city: string | null
          loyaltyLevel: LoyaltyLevel
          bonusBalance: number
          isBlocked: boolean
          blockedReason: string | null
          tfaSecret: string | null
          tfaEnabled: boolean
          tfaBackupCodes: string[] | null
          tfaRequiredFor: string[] | null
          lastLoginIp: string | null
          lastLoginAt: string | null
          isBot: boolean
          botRole: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          email: string
          passwordHash: string
          name: string
          phone?: string | null
          avatar?: string | null
          roles?: UserRole[] | null
          accountType?: AccountType
          legalInfo?: Json | null
          city?: string | null
          loyaltyLevel?: LoyaltyLevel
          bonusBalance?: number
          isBlocked?: boolean
          blockedReason?: string | null
          tfaSecret?: string | null
          tfaEnabled?: boolean
          tfaBackupCodes?: string[] | null
          tfaRequiredFor?: string[] | null
          lastLoginIp?: string | null
          lastLoginAt?: string | null
          isBot?: boolean
          botRole?: string | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          email?: string
          passwordHash?: string
          name?: string
          phone?: string | null
          avatar?: string | null
          roles?: UserRole[] | null
          accountType?: AccountType
          legalInfo?: Json | null
          city?: string | null
          loyaltyLevel?: LoyaltyLevel
          bonusBalance?: number
          isBlocked?: boolean
          blockedReason?: string | null
          tfaSecret?: string | null
          tfaEnabled?: boolean
          tfaBackupCodes?: string[] | null
          tfaRequiredFor?: string[] | null
          lastLoginIp?: string | null
          lastLoginAt?: string | null
          isBot?: boolean
          botRole?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      venues: {
        Row: {
          id: string
          owner_id: string
          name: string
          description: string | null
          address: string
          city: string | null
          region: string | null
          lat: number | null
          lng: number | null
          capacity: number
          price_per_hour: number
          min_rent_hours: number
          images: string[] | null
          amenities: string[] | null
          contacts: Json | null
          rules: string | null
          is_active: boolean
          is_verified: boolean
          verified_at: string | null
          verified_by: string | null
          rating: number | null
          reviews_count: number | null
          bookings_count: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          description?: string | null
          address: string
          city?: string | null
          region?: string | null
          lat?: number | null
          lng?: number | null
          capacity?: number
          price_per_hour?: number
          min_rent_hours?: number
          images?: string[] | null
          amenities?: string[] | null
          contacts?: Json | null
          rules?: string | null
          is_active?: boolean
          is_verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          rating?: number | null
          reviews_count?: number | null
          bookings_count?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          description?: string | null
          address?: string
          city?: string | null
          region?: string | null
          lat?: number | null
          lng?: number | null
          capacity?: number
          price_per_hour?: number
          min_rent_hours?: number
          images?: string[] | null
          amenities?: string[] | null
          contacts?: Json | null
          rules?: string | null
          is_active?: boolean
          is_verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          rating?: number | null
          reviews_count?: number | null
          bookings_count?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      video_feed_items: {
        Row: {
          id: string
          confectionerId: string
          videoUrl: string
          posterUrl: string | null
          title: string
          description: string | null
          viewsCount: number
          likesCount: number
          commentsCount: number
          sharesCount: number
          productId: string | null
          audioTitle: string | null
          status: string
          rating: number
          createdAt: string
        }
        Insert: {
          id: string
          confectionerId: string
          videoUrl: string
          posterUrl?: string | null
          title: string
          description?: string | null
          viewsCount?: number
          likesCount?: number
          commentsCount?: number
          sharesCount?: number
          productId?: string | null
          audioTitle?: string | null
          status?: string
          rating?: number
          createdAt?: string
        }
        Update: {
          id?: string
          confectionerId?: string
          videoUrl?: string
          posterUrl?: string | null
          title?: string
          description?: string | null
          viewsCount?: number
          likesCount?: number
          commentsCount?: number
          sharesCount?: number
          productId?: string | null
          audioTitle?: string | null
          status?: string
          rating?: number
          createdAt?: string
        }
        Relationships: [
        ]
      }
      video_reviews: {
        Row: {
          id: string
          productId: string
          userId: string
          videoUrl: string
          thumbnailUrl: string | null
          rating: number
          text: string | null
          duration: number
          views: number
          likes: number
          createdAt: string
        }
        Insert: {
          id: string
          productId: string
          userId: string
          videoUrl: string
          thumbnailUrl?: string | null
          rating: number
          text?: string | null
          duration: number
          views?: number
          likes?: number
          createdAt?: string
        }
        Update: {
          id?: string
          productId?: string
          userId?: string
          videoUrl?: string
          thumbnailUrl?: string | null
          rating?: number
          text?: string | null
          duration?: number
          views?: number
          likes?: number
          createdAt?: string
        }
        Relationships: [
        ]
      }
      wholesale_prices: {
        Row: {
          id: string
          productId: string
          minQuantity: number
          price: number
          currency: string
          isActive: boolean
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          productId: string
          minQuantity?: number
          price: number
          currency?: string
          isActive?: boolean
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          productId?: string
          minQuantity?: number
          price?: number
          currency?: string
          isActive?: boolean
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      wholesaler_profiles: {
        Row: {
          id: string
          userId: string
          companyName: string
          inn: string | null
          volumePerMonth: number
          contractType: string | null
          rating: number
          isActive: boolean
          metadata: Json | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id: string
          userId: string
          companyName: string
          inn?: string | null
          volumePerMonth?: number
          contractType?: string | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt: string
        }
        Update: {
          id?: string
          userId?: string
          companyName?: string
          inn?: string | null
          volumePerMonth?: number
          contractType?: string | null
          rating?: number
          isActive?: boolean
          metadata?: Json | null
          createdAt?: string
          updatedAt?: string
        }
        Relationships: [
        ]
      }
      wishlist_items: {
        Row: {
          id: string
          userId: string
          productId: string
          note: string | null
          createdAt: string
        }
        Insert: {
          id: string
          userId: string
          productId: string
          note?: string | null
          createdAt?: string
        }
        Update: {
          id?: string
          userId?: string
          productId?: string
          note?: string | null
          createdAt?: string
        }
        Relationships: [
        ]
      }
    }
    Views: {
    }
    Functions: {
    }
    Enums: {
      AccountType: AccountType
      AuditAction: AuditAction
      FillingCategory: FillingCategory
      FillingStatus: FillingStatus
      LoyaltyLevel: LoyaltyLevel
      LoyaltyTxType: LoyaltyTxType
      MaintenanceStatus: MaintenanceStatus
      MaintenanceType: MaintenanceType
      NotificationChannel: NotificationChannel
      NotificationStatus: NotificationStatus
      NotificationTemplate: NotificationTemplate
      OrderStatus: OrderStatus
      OrganizationStatus: OrganizationStatus
      PaymentMethod: PaymentMethod
      PaymentStatus: PaymentStatus
      Tariff: Tariff
      TaxMode: TaxMode
      TrustLevel: TrustLevel
      UserRole: UserRole
      VerificationTrigger: VerificationTrigger
      account_type: account_type
      loyalty_level: loyalty_level
      order_status: order_status
      payment_method: payment_method
      payment_status: payment_status
      tariff: tariff
      tax_mode: tax_mode
      trust_level: trust_level
      user_role: user_role
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          file_size_limit: number | null
          allowed_mime_types: string[] | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          file_size_limit?: number | null
          allowed_mime_types?: string[] | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          file_size_limit?: number | null
          allowed_mime_types?: string[] | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      objects: {
        Row: {
          id: string
          bucket_id: string
          name: string
          owner: string | null
          owner_id: string | null
          version: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
          path_tokens: string[] | null
          user_metadata: Json | null
        }
        Insert: {
          id?: string
          bucket_id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          version?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
          path_tokens?: string[] | null
          user_metadata?: Json | null
        }
        Update: {
          id?: string
          bucket_id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          version?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
          path_tokens?: string[] | null
          user_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
    }
    Functions: {
    }
    Enums: {
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ---- Convenience row types (часто используемые таблицы) ----
export type ConfectionerRow = Database["public"]["Tables"]["confectioners"]["Row"]
export type ConfectionerAtelierRow = Database["public"]["Tables"]["confectioner_ateliers"]["Row"]
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
export type UserRoleRow = Database["public"]["Tables"]["user_roles"]["Row"]
export type AddressRow = Database["public"]["Tables"]["addresses"]["Row"]
export type ProductRow = Database["public"]["Tables"]["products"]["Row"]
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"]
export default Database
