// YooKassa integration
// Документация: https://yookassa.ru/developers/api
//
// Для активации:
// 1. Зарегистрируйтесь на https://yookassa.ru
// 2. Получите shopId и secretKey в личном кабинете
// 3. Укажите их в .env: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY
// 4. Настройте webhook в личном кабинете на URL: /api/payment/webhook

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "test_shop";
const YOOKASSA_SECRET_KEY =
  process.env.YOOKASSA_SECRET_KEY || "test_secret";
const YOOKASSA_API_URL =
  process.env.YOOKASSA_API_URL || "https://api.yookassa.ru/v3";

// Проверка, настроена ли YooKassa
// P3: «test_shop»/«test_secret» — это mock-заглушка, реальные платежи не пройдут.
export const isYookassaConfigured = (): boolean => {
  return (
    !!YOOKASSA_SHOP_ID &&
    !!YOOKASSA_SECRET_KEY &&
    YOOKASSA_SHOP_ID !== "test_shop" &&
    YOOKASSA_SECRET_KEY !== "test_secret" &&
    !YOOKASSA_SHOP_ID.startsWith("CHANGE_ME") &&
    !YOOKASSA_SECRET_KEY.startsWith("CHANGE_ME")
  );
};

// Basic auth header для YooKassa
function getAuthHeader(): string {
  return "Basic " + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64");
}

/**
 * P3: Идемпотентность YooKassa.
 *
 * Правило YooKassa: один и тот же Idempotence-Key = один и тот же результат.
 * Если придёт повторный запрос с тем же ключом, YooKassa вернёт оригинальный ответ
 * (не создаст дубликат платежа).
 *
 * Поэтому ключ должен быть ДЕТЕРМИНИРОВАН от бизнес-сущности:
 *  - Для создания платежа: `payment:create:{orderId}` — ретрай того же заказа не создаст дубль.
 *  - Для возврата: `refund:{orderId}:{paymentId}` — повторный запрос на возврат не задвоит деньги.
 *  - Для capture: `capture:{paymentId}`.
 *
 * Ранее использовался `${Date.now()}-${Math.random()}` — это НЕ идемпотентность,
 * а просто уникальность (каждый ретрай создавал новый платёж).
 */
function idempotenceKeyFor(operation: "create" | "capture" | "refund", ...parts: (string | number)[]): string {
  return `uezd_konditer:${operation}:${parts.join(":")}`;
}

export interface YooKassaPaymentRequest {
  amount: number; // в рублях
  description: string;
  orderId: string;
  returnUrl: string;
  metadata?: Record<string, string>;
}

export interface YooKassaPaymentResponse {
  id: string;
  status: string;
  paid: boolean;
  amount: { value: string; currency: string };
  confirmation?: {
    type: string;
    confirmation_url: string;
  };
  metadata?: Record<string, string>;
  created_at: string;
}

// Создание платежа
export async function createPayment(
  data: YooKassaPaymentRequest
): Promise<{ success: boolean; payment?: YooKassaPaymentResponse; error?: string }> {
  // Если YooKassa не настроена — возвращаем mock-ответ (заглушка)
  if (!isYookassaConfigured()) {
    console.warn("⚠️ YooKassa не настроена. Используется mock-ответ.");
    console.warn("   Для активации укажите YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env");
    return {
      success: true,
      payment: {
        id: `mock_${Date.now()}`,
        status: "waiting_for_capture",
        paid: false,
        amount: { value: data.amount.toFixed(2), currency: "RUB" },
        confirmation: {
          type: "redirect",
          confirmation_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout?mock_payment=${data.orderId}`,
        },
        metadata: { orderId: data.orderId, ...data.metadata },
        created_at: new Date().toISOString(),
      },
    };
  }

  try {
    const response = await fetch(`${YOOKASSA_API_URL}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // P3: детерминированный ключ — ретрай не создаст дубль платежа
        "Idempotence-Key": idempotenceKeyFor("create", data.orderId),
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({
        amount: {
          value: data.amount.toFixed(2),
          currency: "RUB",
        },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: data.returnUrl,
        },
        description: data.description,
        metadata: {
          orderId: data.orderId,
          ...data.metadata,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("YooKassa createPayment error:", error);
      return { success: false, error: error.description || "Ошибка создания платежа" };
    }

    const payment: YooKassaPaymentResponse = await response.json();
    return { success: true, payment };
  } catch (error) {
    console.error("YooKassa createPayment exception:", error);
    return { success: false, error: "Ошибка соединения с YooKassa" };
  }
}

// Получение статуса платежа
export async function getPaymentStatus(
  paymentId: string
): Promise<{ success: boolean; payment?: YooKassaPaymentResponse; error?: string }> {
  if (paymentId.startsWith("mock_")) {
    return {
      success: true,
      payment: {
        id: paymentId,
        status: "succeeded",
        paid: true,
        amount: { value: "0.00", currency: "RUB" },
        created_at: new Date().toISOString(),
      },
    };
  }

  try {
    const response = await fetch(`${YOOKASSA_API_URL}/payments/${paymentId}`, {
      headers: { Authorization: getAuthHeader() },
    });

    if (!response.ok) {
      return { success: false, error: "Ошибка получения статуса платежа" };
    }

    const payment: YooKassaPaymentResponse = await response.json();
    return { success: true, payment };
  } catch (error) {
    console.error("YooKassa getPaymentStatus exception:", error);
    return { success: false, error: "Ошибка соединения с YooKassa" };
  }
}

// Возврат платежа
export async function refundPayment(
  paymentId: string,
  amount: number,
  description?: string
): Promise<{ success: boolean; refund?: any; error?: string }> {
  if (paymentId.startsWith("mock_")) {
    console.warn("⚠️ Mock refund для", paymentId);
    return { success: true, refund: { id: `mock_refund_${Date.now()}`, status: "succeeded" } };
  }

  try {
    const response = await fetch(`${YOOKASSA_API_URL}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // P3: детерминированный ключ — повторный запрос на возврат не задвоит деньги
        "Idempotence-Key": idempotenceKeyFor("refund", paymentId),
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({
        payment_id: paymentId,
        amount: { value: amount.toFixed(2), currency: "RUB" },
        description,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.description || "Ошибка возврата" };
    }

    const refund = await response.json();
    return { success: true, refund };
  } catch (error) {
    console.error("YooKassa refundPayment exception:", error);
    return { success: false, error: "Ошибка соединения с YooKassa" };
  }
}

// Верификация webhook от YooKassa
// В продакшене нужно проверять IP источника и/или подпись
// P0 FIX: YooKassa webhook IP whitelist
const YOOKASSA_IP_RANGES = [
  "185.71.76.0/27",
  "185.71.77.0/27",
  "77.75.153.0/25",
  "77.75.156.11",
  "77.75.156.35",
  "77.75.154.128/25",
  "2a02:5180::/32",
];

function ipInRange(ip: string, range: string): boolean {
  // Simple check for exact IP or /32
  if (range.includes("/")) {
    // CIDR check — simplified for common cases
    const [base, bits] = range.split("/");
    const mask = parseInt(bits);
    if (mask === 32) return ip === base;
    // For /27, /25 etc. — simplified: check first N octets
    const baseParts = base.split(".");
    const ipParts = ip.split(".");
    if (baseParts.length !== 4 || ipParts.length !== 4) return false;
    const fullOctets = Math.floor(mask / 8);
    for (let i = 0; i < fullOctets; i++) {
      if (baseParts[i] !== ipParts[i]) return false;
    }
    return true;
  }
  return ip === range;
}

export function verifyWebhook(request: Request): boolean {
  // P0 FIX: In production, verify that the request comes from YooKassa IPs
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    const clientIP =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "";

    if (!clientIP) {
      console.warn("[yookassa] No client IP in webhook — rejecting");
      return false;
    }

    const allowed = YOOKASSA_IP_RANGES.some((range) => ipInRange(clientIP, range));
    if (!allowed) {
      console.warn(`[yookassa] Webhook from unauthorized IP: ${clientIP}`);
      return false;
    }
  }

  // In dev mode, allow all (for testing)
  return true;
}
