/**
 * Anti-fraud: лимиты заказов/регистраций/логинов с одного IP/устройства.
 *
 * Правила:
 *  - order_create: не более 5 заказов в час с IP, не более 20 в день
 *  - register: не более 3 ПОПЫТКИ регистрации в час И не более 10 в сутки с IP
 *    (решение владельца 2026-10-17: ИСХОДНЫЙ лимит сохранён — повышение 3→10
 *    не подтверждено; считается каждая попытка, включая невалидные — strict
 *    против mass-register. Дневной лимит 10/24ч enforced с v4.6 — до этого
 *    maxPerDay был объявлен в конфиге, но не проверялся).
 *    E2E-совместимость: спеки, реально регистрирующие пользователей, шлют
 *    per-spec симулированный x-real-ip (доверенный канал, в production
 *    перезаписывается Caddy — см. tests/e2e/*.spec.ts и docs/DNS_SETUP.md)
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
 *
 * ДОВЕРЕННЫЙ ПРОКСИ: клиентский X-Forwarded-For подделываем — брать ПЕРВЫЙ
 * элемент небезопасно, если запрос может прийти напрямую мимо доверенного
 * прокси (обход rate-limit). Порядок доверия:
 *   1. x-real-ip — заголовок доверенного reverse proxy (Caddy/nginx ставят
 *      его перезаписью клиентского значения).
 *   2. ХВОСТ x-forwarded-for с учётом TRUSTED_PROXY_HOPS (кол-во доверенных
 *      прокси на пути, default 1) — реальный клиент в конце цепочки.
 *   3. Иначе 0.0.0.0 (локальный/неизвестный).
 *
 * Эксплуатация: порт Next (:3000) не должен быть доступен извне напрямую —
 * только через Caddy (см. docs/DNS_SETUP.md, раздел «Доверенный прокси»).
 */
export function extractIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS || 1) || 1);
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const idx = parts.length - hops;
    if (idx >= 0 && parts[idx]) return parts[idx];
  }
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
 * Проверяются ОБА окна: час (maxPerHour) и сутки (maxPerDay).
 * Дневная проверка выполняется только когда часовая пройдена — на частом
 * отказном пути экономим один запрос.
 *
 * ВАЖНО: между проверкой и записью есть окно race condition, но
 * для rate-limiting это приемлемо — один-два лишних запроса не критичны,
 * а полная транзакция замедлила бы каждый запрос.
 * (Strict-порядок insert→count устраняет гонку размывания счётчика.)
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

  // STRICT-порядок: сначала пишем попытку, потом считаем окно.
  // Прежний порядок (count → insert) при N конкурентных запросах позволял
  // всем пройти до первой записи — лимит занижался. Теперь каждая попытка
  // даёт ровно одну запись: гонка не размывает счётчик.
  const { error: logErr } = await supabaseAdmin.from("order_fraud_logs").insert({
    ip_hash: ipHash,
    device_fp: deviceFp || null,
    user_id: userId || null,
    action,
    created_at: new Date().toISOString(),
  });

  if (logErr) {
    console.warn("[anti-fraud] log insert failed:", logErr.message);
    // Fail-open: не смогли записать попытку — пропускаем, иначе сбой лога
    // блокирует всех пользователей.
    return {
      allowed: true,
      remaining: config.maxPerHour,
      resetAt: now + 60 * 60 * 1000,
    };
  }

  // Считаем попытки за последний час (включая только что записанную)
  const { count, error } = await supabaseAdmin
    .from("order_fraud_logs")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("action", action)
    .gte("created_at", hourAgoIso);

  if (error) {
    console.error("[anti-fraud] count failed:", error.message);
    // Fail-open: лучше пропустить запрос, чем блокировать всех при сбое БД.
    return {
      allowed: true,
      remaining: config.maxPerHour,
      resetAt: now + 60 * 60 * 1000,
    };
  }

  const recentCount = count || 0;
  const resetAt = now + 60 * 60 * 1000;

  if (recentCount > config.maxPerHour) {
    // Отклонённая попытка остаётся в логе: окно расходуется и на отказы —
    // осознанный strict-режим против брутфорса/масс-регистрации.
    return {
      allowed: false,
      reason: `Превышен лимит ${action} (${config.maxPerHour}/час с вашего IP). Попробуйте позже.`,
      remaining: 0,
      resetAt,
    };
  }

  // ===== Дневное окно (24ч): maxPerDay — enforced с v4.6 =====
  // До v4.6 maxPerDay существовал только в конфиге (умершие данные):
  // checkFraudLimit сравнивал счётчик только с maxPerHour, и атакующий
  // мог держать ровно maxPerHour попыток каждый час = до 24*maxPerHour в сутки.
  const dayAgoIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { count: dayCount, error: dayErr } = await supabaseAdmin
    .from("order_fraud_logs")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("action", action)
    .gte("created_at", dayAgoIso);

  if (dayErr) {
    console.error("[anti-fraud] day-count failed:", dayErr.message);
    // Fail-open: консистентно с часовой проверкой (см. комментарий выше).
    return {
      allowed: true,
      remaining: config.maxPerHour - recentCount,
      resetAt,
    };
  }

  if ((dayCount || 0) > config.maxPerDay) {
    return {
      allowed: false,
      reason: `Превышен суточный лимит ${action} (${config.maxPerDay}/24ч с вашего IP). Попробуйте позже.`,
      remaining: 0,
      resetAt: now + 24 * 60 * 60 * 1000,
    };
  }

  return {
    allowed: true,
    remaining: config.maxPerHour - recentCount,
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
