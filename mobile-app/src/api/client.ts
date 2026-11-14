/**
 * API client for "Кондитера" mobile app.
 *
 * Same backend API as the web app (Next.js /api/*).
 * Base URL is configurable via Expo Constants (app.json → extra.apiUrl).
 *
 * Auth flow:
 *   - After login, tokens are stored in SecureStore (encrypted on device)
 *   - Access token attached to every request as `Authorization: Bearer <token>`
 *   - On 401, automatically tries refresh token once
 *   - If refresh fails → logout, redirect to login screen
 */
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  "http://localhost:3000";

const ACCESS_TOKEN_KEY = "conditera_access_token";
const REFRESH_TOKEN_KEY = "conditera_refresh_token";

export async function getTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return { accessToken, refreshToken };
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip auth header (for login/register) */
  skipAuth?: boolean;
  /** Override default 15s timeout */
  timeoutMs?: number;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Singleton refresh — if multiple requests fail simultaneously, share one refresh
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const { refreshToken } = await getTokens();
    if (!refreshToken) return null;

    try {
      const resp = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const newAccessToken = data.accessToken;
      if (newAccessToken) {
        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, newAccessToken);
        return newAccessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, skipAuth = false, timeoutMs = 15000 } = options;

  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (!skipAuth) {
    const { accessToken } = await getTokens();
    if (accessToken) {
      finalHeaders.Authorization = `Bearer ${accessToken}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const doFetch = (token: string | null) =>
    fetch(url, {
      method,
      headers: token ? { ...finalHeaders, Authorization: `Bearer ${token}` } : finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

  try {
    let { accessToken } = skipAuth ? { accessToken: null } : await getTokens();
    let response = await doFetch(accessToken);

    // 401 → try refresh, then retry once
    if (response.status === 401 && !skipAuth) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        response = await doFetch(newToken);
      } else {
        await clearTokens();
        throw new ApiError(401, "Сессия истекла, войдите снова");
      }
    }

    if (!response.ok) {
      let errBody: unknown;
      try {
        errBody = await response.json();
      } catch {
        errBody = await response.text();
      }
      const message =
        (errBody && typeof errBody === "object" && "error" in errBody
          ? String((errBody as { error: unknown }).error)
          : `HTTP ${response.status}`) || `HTTP ${response.status}`;
      throw new ApiError(response.status, message, errBody);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ===== Auth API =====
export const authApi = {
  login: (email: string, password: string) =>
    apiRequest<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuth: true,
    }),

  register: (data: {
    email: string;
    password: string;
    name: string;
    phone: string;
    role?: string;
  }) =>
    apiRequest<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>("/api/auth/register", {
      method: "POST",
      body: data,
      skipAuth: true,
    }),

  refresh: (refreshToken: string) =>
    apiRequest<{ accessToken: string }>("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      skipAuth: true,
    }),
};

// ===== Products API =====
export const productsApi = {
  list: (params: {
    category?: string;
    q?: string;
    sort?: string;
    limit?: number;
    offset?: number;
    confectionerId?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    });
    return apiRequest<{ products: Product[]; total: number; limit: number; offset: number }>(
      `/api/products?${qs.toString()}`
    );
  },

  byId: (id: string) => apiRequest<{ product: Product }>(`/api/products/${id}`),
};

// ===== Confectioners API =====
export const confectionersApi = {
  list: (params: { city?: string; sort?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, String(v));
    });
    return apiRequest<{ confectioners: Confectioner[] }>(`/api/confectioners?${qs.toString()}`);
  },
};

// ===== Orders API =====
export const ordersApi = {
  list: (status?: string) =>
    apiRequest<{ orders: Order[] }>(
      `/api/orders${status ? `?status=${status}` : ""}`
    ),

  create: (data: {
    items: Array<{
      productId: string;
      quantity: number;
      customization?: Record<string, unknown>;
    }>;
    deliveryAddress?: string;
    deliveryDate: string;
    deliveryTime?: string;
    deliveryCost?: number;
    paymentMethod?: string;
    comment?: string;
  }) => apiRequest<{ order: Order }>("/api/orders", { method: "POST", body: data }),
};

// ===== Loyalty API =====
export const loyaltyApi = {
  history: () =>
    apiRequest<{
      balance: number;
      level: string;
      totalSpent: number;
      transactions: LoyaltyTransaction[];
    }>("/api/loyalty/history"),

  levels: () => apiRequest<{ levels: Record<string, LevelConfig> }>("/api/loyalty/levels"),

  redeemPreview: (orderId: string) =>
    apiRequest<{
      balance: number;
      orderTotal: number;
      maxRedeemable: number;
      maxPercent: number;
      minRedemption: number;
    }>(`/api/loyalty/redeem?orderId=${orderId}`),

  redeem: (orderId: string, requestedPoints: number) =>
    apiRequest<{
      redeemedPoints: number;
      discountRub: number;
      newBalance: number;
    }>("/api/loyalty/redeem", {
      method: "POST",
      body: { orderId, requestedPoints },
    }),
};

// ===== Notifications API =====
export const notificationsApi = {
  list: (unreadOnly = false) =>
    apiRequest<{ notifications: Notification[] }>(
      `/api/notifications/list?unreadOnly=${unreadOnly}`
    ),

  unreadCount: () =>
    apiRequest<{ count: number }>("/api/notifications/unread-count"),

  markRead: (notificationIds?: string[]) =>
    apiRequest<{ success: boolean; marked: number | string }>(
      "/api/notifications/mark-read",
      { method: "POST", body: notificationIds ? { notificationIds } : { all: true } }
    ),

  preferences: () =>
    apiRequest<{ preferences: NotificationPreferences }>(
      "/api/notifications/preferences"
    ),

  updatePreferences: (data: Partial<NotificationPreferences>) =>
    apiRequest<{ preferences: NotificationPreferences }>(
      "/api/notifications/preferences",
      { method: "PUT", body: data }
    ),
};

// ===== Promotions API =====
export const promotionsApi = {
  list: (city?: string, type?: string) => {
    const qs = new URLSearchParams();
    if (city) qs.set("city", city);
    if (type) qs.set("type", type);
    return apiRequest<{ promotions: Promotion[] }>(`/api/promotions?${qs.toString()}`);
  },
};

// ===== Payment API =====
export const paymentApi = {
  create: (orderId: string) =>
    apiRequest<{
      paymentId: string;
      yookassaId: string;
      status: string;
      confirmationUrl: string;
      isMock: boolean;
      message?: string;
    }>("/api/payment/create", { method: "POST", body: { orderId } }),
};

// ===== SimpleX Chat API (приватный E2E-канал) =====
export type SimpleXContact = {
  id: string;
  simplexAddress: string | null;
  simplexName: string | null;
  profileType: string;
  active: boolean;
  connectionsCount: number;
  createdAt: string;
};

export type SimpleXMessage = {
  id: string;
  simplexChatId: string;
  simplexMsgId: string;
  fromName: string | null;
  text: string | null;
  metadata: { messageType?: string; files?: any[] } | null;
  direction: "incoming" | "outgoing";
  readByOperator: boolean;
  receivedAt: string;
};

export type SimpleXSupportAddress = {
  available: boolean;
  address?: string;
  displayName?: string;
  qrUrl?: string;
  deepLink?: string;
  instructions?: {
    step1: string;
    step2: string;
    step3: string;
    step4: string;
  };
};

export const simplexApi = {
  // Публичный адрес поддержки маркетплейса (без авторизации)
  supportAddress: () =>
    apiRequest<SimpleXSupportAddress>("/api/simplex/support-address"),

  // Профиль текущего пользователя + последние сообщения + статистика
  getProfile: () =>
    apiRequest<{
      contact: SimpleXContact | null;
      recentMessages: SimpleXMessage[];
      stats: { total: number; unread: number };
      connectInstructions: {
        address: string;
        qrUrl: string;
        deepLink: string;
      } | null;
    }>("/api/simplex/contacts"),

  // Создать SimpleX-профиль (только кондитеры)
  createProfile: () =>
    apiRequest<{
      success: boolean;
      contact: SimpleXContact;
      connectInstructions: {
        address: string;
        qrUrl: string;
        deepLink: string;
      };
    }>("/api/simplex/contacts", { method: "POST" }),

  // Деактивировать профиль
  deleteProfile: () =>
    apiRequest<{ success: boolean }>("/api/simplex/contacts", { method: "DELETE" }),

  // Отправить ответ через SimpleX
  send: (contactName: string, text: string, chatId?: string) =>
    apiRequest<{ success: boolean; result: any }>(
      "/api/simplex/send",
      { method: "POST", body: { contactName, text, chatId } }
    ),

  // Отметить сообщения прочитанными
  markRead: (messageIds?: string[], all?: boolean, chatId?: string) =>
    apiRequest<{ success: boolean }>(
      "/api/simplex/read",
      { method: "POST", body: { messageIds, all, chatId } }
    ),
};

// ===== Types (re-exported for convenience) =====
export type User = {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  roles: string[];
  city?: string;
  loyaltyLevel?: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
  bonusBalance?: number;
  accountType?: "individual" | "legal";
  isBlocked?: boolean;
};

export type Product = {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  oldPrice?: number;
  category: string;
  images: string[];
  confectionerId: string;
  confectioner?: { id: string; businessName: string; avatar: string; verified: boolean; city: string };
  rating: number;
  reviewsCount: number;
  weight?: string;
  servings?: number;
  prepTime?: string;
  isPopular?: boolean;
  isNew?: boolean;
  isHit?: boolean;
  tags?: string[];
  fillings?: Array<{ name: string; priceModifier: number }>;
  coatings?: Array<{ name: string; priceModifier: number }>;
  decorations?: Array<{ name: string; priceModifier: number }>;
  paymentOptions?: Record<string, unknown>;
  modelUrl?: string;
  modelUsdzUrl?: string;
  arEnabled?: boolean;
};

export type Confectioner = {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  description: string;
  avatar: string;
  cover?: string;
  city: string;
  location: Record<string, unknown>;
  rating: number;
  reviewsCount: number;
  ordersCount: number;
  verified: boolean;
  trustLevel: string;
  tariff: string;
  legalInfo: Record<string, unknown>;
  taxMode: string;
  specialization: string[];
  portfolioImages: string[];
  followersCount: number;
  responseTime: string;
  selfPickup: boolean;
  deliveryOptions: string[];
  paymentSettings?: Record<string, unknown>;
  ecoBadges: string[];
  balance: number;
  totalEarnings: number;
  monthlyEarnings: number;
};

export type OrderStatus =
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

export type Order = {
  id: string;
  number: string;
  customerId: string;
  confectionerId?: string;
  courierId?: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  deliveryAddress?: string;
  deliveryDate: string;
  deliveryTime?: string;
  deliveryCost: number;
  paymentMethod: string;
  paymentStatus: string;
  comment?: string;
  createdAt: string;
  confectioner?: { businessName: string; avatar: string };
};

export type OrderItem = {
  id: string;
  productId: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  customization?: Record<string, unknown>;
};

export type LoyaltyTransaction = {
  id: string;
  userId: string;
  type:
    | "EARN"
    | "REDEEM"
    | "EXPIRE"
    | "REFUND"
    | "ADJUST"
    | "BONUS_WELCOME"
    | "BONUS_BIRTHDAY"
    | "BONUS_REFERRAL";
  points: number;
  balanceAfter: number;
  description: string;
  orderId?: string;
  amount?: number;
  expiresAt?: string;
  createdAt: string;
};

export type LevelConfig = {
  name: string;
  minSpent: number;
  discount: number;
  multiplier: number;
  color: string;
  perks: string[];
};

export type Notification = {
  id: string;
  userId: string;
  template: string;
  channel: string;
  status: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
};

export type NotificationPreferences = {
  userId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  telegramEnabled: boolean;
  inAppEnabled: boolean;
  orderUpdates: boolean;
  paymentUpdates: boolean;
  promos: boolean;
  messages: boolean;
  reviews: boolean;
  loyalty: boolean;
  abandonedCart: boolean;
  digest: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  maxPerDay: number;
};

export type Promotion = {
  id: string;
  confectionerId: string;
  title: string;
  description: string;
  type: string;
  value?: number;
  promoCode?: string;
  minOrderAmount?: number;
  startDate: string;
  endDate: string;
  cities: string[];
  status: string;
  image?: string;
  usedCount: number;
};
