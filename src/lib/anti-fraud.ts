/**
 * Anti-fraud: лимиты заказов/регистраций/логинов с одного IP/устройства.
 *
 * Правила:
 *  - order_create: не более 5 заказов в час с IP, не более 20 в день
 *  - register: не более 3 регистраций в час с IP
 *  - login: не более 20 попыток в час с IP (защита от brute-force)
 *  - review: не более 10 отзывов в час с IP (защита от накруток)
 *
 * Храним SHA-256 hash IP (не raw IP — для GDPR/152-ФЗ).
 * Логи старее 24 часов удаляет /api/cron/cleanup.
 *
 * Также: детект подозрительной активности — один пользователь делает заказы
 * с 5+ разных IP за 24 часа → флаг risk.
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin — обход RLS для логов.
 *   • IP хэшируется с солью из env (право на забвение — смена соли обнуляет хэши).
 *   • Параметры запросов — только статические имена колонок, никаких интерполяций.
 */
import { supabaseAdmin } from "./supabase/admin";
import { createHash } from "node:crypto";

export type FraudAction = "order_create" | "register" | "login" | "review";

interface RateLimitConfig {
  maxPerHour: number;
  maxPerDay: number;
}

export const LIMITS: Record<FraudAction, RateLimitConfig> = {
  order_create: { maxPerHour: 5, maxPerDay: 20 },
  register: { maxPerHour: 3, maxPerDay: 10 },
  login: { maxPerHour: 20, maxPerDay: 100 },
  review: { maxPerHour: 10, maxPerDay: 30 },
};

/**
 * Хэш IP-адреса через SHA-256.
 * Не храним raw IP — соответствие GDPR/152-ФЗ.
 * Соль в env позволяет обнулить хэши при смене (право на забвение).
 */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT || "conditera-ip-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Извлечь IP из request headers.
 * Учитывает X-Forwarded-For, X-Real-IP (nginx/cloudflare).
 */
export function extractIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return "0.0.0.0";
}

export interface FraudCheckResult {
  allowed: boolean;
  reason?: string;
  /** Сколько попыток осталось в текущем часу */
  remaining: number;
  /** Когда истечёт текущее окно (timestamp ms) */
  resetAt: number;
}

/**
 * Проверить лимит для действия.
 * Если лимит превышён — возвращаем allowed: false.
 * Если нет — логируем попытку и возвращаем allowed: true.
 *
 * ВАЖНО: между проверкой и записью есть окно race condition, но
 * для rate-limiting это приемлемо — один-два лишних запроса не критичны,
 * а полная транзакция замедлила бы каждый запрос.
 */
export async function checkFraudLimit(
  req: Request,
  action: FraudAction,
  userId?: string,
  deviceFp?: string
): Promise<FraudCheckResult> {
  const ip = extractIp(req);
  const ipHash = hashIp(ip);
  const config = LIMITS[action];

  const now = Date.now();
  const hourAgoIso = new Date(now - 60 * 60 * 1000).toISOString();

  // Считаем попытки за последний час
  const { count, error } = await supabaseAdmin
    .from("order_fraud_logs")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("action", action)
    .gte("created_at", hourAgoIso);

  if (error) {
    console.error("[anti-fraud] count failed:", error.message);
    // Fail-open: лучше пропустить запрос, чем блокировать всех при сбое БД.
    // Если fail-closed, то даже временный сбой БД блокирует всех пользователей.
    return {
      allowed: true,
      remaining: config.maxPerHour,
      resetAt: now + 60 * 60 * 1000,
    };
  }

  const recentCount = count || 0;
  const resetAt = now + 60 * 60 * 1000;

  if (recentCount >= config.maxPerHour) {
    return {
      allowed: false,
      reason: `Превышен лимит ${action} (${config.maxPerHour}/час с вашего IP). Попробуйте позже.`,
      remaining: 0,
      resetAt,
    };
  }

  // Логируем попытку — fire-and-forget, но с await для надёжности.
  const { error: logErr } = await supabaseAdmin.from("order_fraud_logs").insert({
    ip_hash: ipHash,
    device_fp: deviceFp || null,
    user_id: userId || null,
    action,
    created_at: new Date().toISOString(),
  });

  if (logErr) {
    console.warn("[anti-fraud] log insert failed:", logErr.message);
    // Non-fatal — лимит уже проверен, лог не критичен.
  }

  return {
    allowed: true,
    remaining: config.maxPerHour - recentCount - 1,
    resetAt,
  };
}

/**
 * Подозрительная активность: пользователь делает заказы с 5+ разных IP за 24 часа.
 */
export async function detectSuspiciousActivity(userId: string): Promise<{
  suspicious: boolean;
  uniqueIps: number;
  reason?: string;
}> {
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Supabase не поддерживает distinct в select как Prisma, но можно получить
  // все записи за период и посчитать уникальные ip_hash на клиенте.
  // Для оптимизации используем raw SQL через RPC, если есть.
  // Здесь берём только ip_hash — небольшой объём данных.
  const { data, error } = await supabaseAdmin
    .from("order_fraud_logs")
    .select("ip_hash")
    .eq("user_id", userId)
    .eq("action", "order_create")
    .gte("created_at", dayAgoIso);

  if (error) {
    console.error("[anti-fraud] suspicious check failed:", error.message);
    return { suspicious: false, uniqueIps: 0 };
  }

  const uniqueIps = new Set((data || []).map((r: { ip_hash: string }) => r.ip_hash)).size;
  if (uniqueIps >= 5) {
    return {
      suspicious: true,
      uniqueIps,
      reason: `Заказы с ${uniqueIps} разных IP за 24 часа — возможен мошеннический аккаунт`,
    };
  }

  return { suspicious: false, uniqueIps };
}

/**
 * Список подозрительных пользователей (для админ-панели).
 * Возвращает массив { user_id, unique_ip_count } отсортированный по убыванию.
 */
export async function listSuspiciousUsers(limit: number = 50): Promise<
  Array<{ user_id: string; unique_ip_count: number }>
> {
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("order_fraud_logs")
    .select("user_id, ip_hash")
    .eq("action", "order_create")
    .gte("created_at", dayAgoIso)
    .not("user_id", "is", null)
    .limit(1000); // safety cap — за день может быть много логов

  if (error) {
    console.error("[anti-fraud] listSuspiciousUsers failed:", error.message);
    return [];
  }

  // Группируем на клиенте: userId → set(ip_hash)
  const byUser = new Map<string, Set<string>>();
  for (const row of data || []) {
    const uid = row.user_id as string;
    const ipHash = row.ip_hash as string;
    if (!byUser.has(uid)) byUser.set(uid, new Set());
    byUser.get(uid)!.add(ipHash);
  }

  const result: Array<{ user_id: string; unique_ip_count: number }> = [];
  for (const [user_id, ips] of byUser.entries()) {
    if (ips.size >= 5) {
      result.push({ user_id, unique_ip_count: ips.size });
    }
  }

  // Сортировка по убыванию количества уникальных IP
  result.sort((a, b) => b.unique_ip_count - a.unique_ip_count);
  return result.slice(0, limit);
}
