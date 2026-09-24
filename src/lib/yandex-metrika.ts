/**
 * Яндекс Метрика — клиентская и серверная аналитика.
 *
 * Клиентский трекинг (window.ym) — для событий в браузере:
 *   add_to_cart, order_completed, user_registered, lead_submitted, ticket_created
 *
 * Серверный трекинг (API) — для событий, инициированных webhook'ами или cron:
 *   payment_succeeded, refund_processed, bonus_redeemed
 *
 * Документация:
 *   - https://yandex.ru/support/metrica/quick-start.html
 *   - https://yandex.ru/support/metrica/ecommerce.html
 *   - https://yandex.ru/support/metrica/server-side-tracking.html
 */

// ===== Types =====
declare global {
  interface Window {
    ym?: (id: number, action: string, params?: any, params2?: any) => void
    dataLayer?: any[]
  }
}

const METRIKA_ID = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID || 111432662)
const METRIKA_OAUTH_TOKEN = process.env.YANDEX_METRIKA_OAUTH_TOKEN

// ===== Client-side tracking (browser only) =====

/**
 * Отправить цель в Метрику (client-side).
 * Использовать в обработчиках событий на клиенте: onClick, onSuccess.
 *
 * @example
 *   trackEvent("add_to_cart", { productId: "p1", price: 1500 })
 */
export function trackEvent(
  event: string,
  params?: Record<string, any>
): void {
  if (typeof window === "undefined" || !window.ym || !METRIKA_ID) return
  try {
    window.ym(METRIKA_ID, "reachGoal", event, params)
  } catch (err) {
    console.warn("[yandex-metrika] trackEvent failed:", err)
  }
}

/**
 * Установить параметры пользователя (для сегментации).
 * Вызывать после авторизации.
 *
 * @example
 *   setUserParams({ userId: "u123", role: "CUSTOMER", loyaltyLevel: "GOLD" })
 */
export function setUserParams(params: {
  userId?: string
  role?: string
  loyaltyLevel?: string
  ordersCount?: number
  totalSpent?: number
  city?: string
  email?: string
  phone?: string
}): void {
  if (typeof window === "undefined" || !window.ym || !METRIKA_ID) return
  try {
    window.ym(METRIKA_ID, "userParams", {
      user_id: params.userId,
      role: params.role,
      loyalty_level: params.loyaltyLevel,
      orders_count: params.ordersCount,
      total_spent: params.totalSpent,
      city: params.city,
      email: params.email,
      phone: params.phone,
    })
  } catch (err) {
    console.warn("[yandex-metrika] setUserParams failed:", err)
  }
}

/**
 * Отследить просмотр страницы (для SPA-роутинга).
 * Next.js App Router не делает полный page reload — нужно вручную.
 *
 * @example
 *   useEffect(() => { trackPageView("/catalog") }, [pathname])
 */
export function trackPageView(url: string, title?: string): void {
  if (typeof window === "undefined" || !window.ym || !METRIKA_ID) return
  try {
    window.ym(METRIKA_ID, "hit", url, { title: title || document.title })
  } catch (err) {
    console.warn("[yandex-metrika] trackPageView failed:", err)
  }
}

// ===== Ecommerce tracking (dataLayer) =====

export interface EcommerceProduct {
  id: string
  name: string
  price: number
  category?: string
  brand?: string       // confectionerName
  quantity: number
  variant?: string     // filling/coating
}

export interface EcommerceOrder {
  id: string           // order ID
  revenue: number      // total
  products: EcommerceProduct[]
}

/**
 * Ecommerce: добавление товара в корзину.
 */
export function trackAddToCart(product: EcommerceProduct): void {
  if (typeof window === "undefined") return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    ecommerce: {
      currencyCode: "RUB",
      add: { products: [product] },
    },
  })
  trackEvent("add_to_cart", { productId: product.id, price: product.price })
}

/**
 * Ecommerce: удаление товара из корзины.
 */
export function trackRemoveFromCart(product: EcommerceProduct): void {
  if (typeof window === "undefined") return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    ecommerce: {
      currencyCode: "RUB",
      remove: { products: [product] },
    },
  })
}

/**
 * Ecommerce: успешная покупка.
 * Вызывать на странице /checkout/success после подтверждения оплаты.
 */
export function trackPurchase(order: EcommerceOrder): void {
  if (typeof window === "undefined") return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    ecommerce: {
      currencyCode: "RUB",
      purchase: {
        actionField: {
          id: order.id,
          revenue: order.revenue,
        },
        products: order.products,
      },
    },
  })
  trackEvent("order_completed", {
    order_id: order.id,
    revenue: order.revenue,
  })
}

/**
 * Ecommerce: просмотр товара (детальная страница).
 */
export function trackProductDetail(product: EcommerceProduct): void {
  if (typeof window === "undefined") return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    ecommerce: {
      currencyCode: "RUB",
      detail: { products: [product] },
    },
  })
}

// ===== Специфичные функции =====

export const trackRegistration = (params?: { role?: string; city?: string }) =>
  trackEvent("user_registered", params)

export const trackLogin = (role?: string) =>
  trackEvent("user_logged_in", { role })

export const trackLeadSubmitted = (params: { source?: string; budget?: number }) =>
  trackEvent("lead_submitted", params)

export const trackTicketCreated = (params: { priority?: string; category?: string }) =>
  trackEvent("ticket_created", params)

export const trackSearch = (query: string, resultsCount: number) =>
  trackEvent("search_performed", { query, results_count: resultsCount })

export const trackConfectionerProfileView = (confectionerId: string) =>
  trackEvent("confectioner_profile_view", { confectionerId })

export const trackSubscribeConfectioner = (confectionerId: string) =>
  trackEvent("subscribe_confectioner", { confectionerId })

export const trackReviewSubmitted = (rating: number, productId: string) =>
  trackEvent("review_submitted", { rating, productId })

export const trackCakeBuilderOpened = () =>
  trackEvent("cake_builder_opened")

export const trackCakeBuilderCompleted = (totalPrice: number) =>
  trackEvent("cake_builder_completed", { total_price: totalPrice })

export const trackGiftCertPurchased = (amount: number) =>
  trackEvent("gift_cert_purchased", { amount })

export const trackRefundRequested = (orderId: string, amount: number) =>
  trackEvent("refund_requested", { orderId, amount })

export const trackDisputeOpened = (orderId: string) =>
  trackEvent("dispute_opened", { orderId })

// ===== Server-side tracking (for webhooks, cron, API-only events) =====

/**
 * Отправить цель в Метрику с сервера (server-side tracking).
 * Использует Yandex Metrika API — требует OAuth-токен.
 *
 * Документация: https://yandex.ru/support/metrica/management/counter.html
 *
 * @example
 *   await trackEventServer("payment_succeeded", { orderId: "o123", amount: 1500 })
 */
export async function trackEventServer(
  event: string,
  params?: Record<string, any>
): Promise<void> {
  if (!METRIKA_ID || !METRIKA_OAUTH_TOKEN) {
    // Если токена нет — логируем и пропускаем (не блокируем основной код)
    console.debug("[yandex-metrika] Server-side tracking skipped — no OAuth token")
    return
  }

  try {
    const response = await fetch(
      `https://api-metrika.yandex.net/management/v1/counter/${METRIKA_ID}/goals/reached`,
      {
        method: "POST",
        headers: {
          "Authorization": `OAuth ${METRIKA_OAUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: event,
          target_params: params || {},
        }),
      }
    )

    if (!response.ok) {
      console.warn(`[yandex-metrika] Server-side tracking failed: ${response.status}`)
    }
  } catch (err) {
    console.warn("[yandex-metrika] Server-side tracking error:", err)
  }
}

// ===== UTM tracking (для лидов и регистрации) =====

/**
 * Собрать UTM-метки из URL для передачи в CRM.
 * Использовать в формах захвата лидов и регистрации.
 *
 * @example
 *   const utm = collectUtm()
 *   // { utm_source: "yandex", utm_medium: "cpc", utm_campaign: "spring_sale" }
 */
export function collectUtm(): Record<string, string> {
  if (typeof window === "undefined") return {}

  const params = new URLSearchParams(window.location.search)
  const utm: Record<string, string> = {}

  const utmKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]

  for (const key of utmKeys) {
    const value = params.get(key)
    if (value) utm[key] = value
  }

  // Также собираемyclid (Яндекс Директ)
  const yclid = params.get("_yclid")
  if (yclid) utm.yclid = yclid

  return utm
}
