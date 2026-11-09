/**
 * fingerprint.ts — стабильный отпечаток ошибки для объединения
 * повторяющихся событий в один инцидент (DEPLOY-01 §3.1, §4).
 *
 * Инвариант: одна и та же логическая ошибка (тот же компонент, код,
 * нормализованное сообщение и маршрут) даёт ОДИН и тот же fingerprint —
 * независимо от времени, пользователя и динамических деталей (id заказов,
 * числа, UUID) в сообщении.
 */

import { createHash } from "crypto";

/**
 * Нормализация сообщения: вырезаем динамические фрагменты (UUID, длинные
 * числа, hex-хэши, path-параметры, кавычки), схлопываем пробелы, нижний
 * регистр. Цель — stable key для группировки.
 */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    // UUID (вкл. без дефисов)
    .replace(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/g, "<uuid>")
    // hex-хэши ≥ 16 символов
    .replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
    // длинные числа (id, суммы, таймстампы) ≥ 4 цифр
    .replace(/\b\d{4,}\b/g, "<num>")
    // числа с десятичной частью (цены)
    .replace(/\b\d+[.,]\d+\b/g, "<num>")
    // короткие числа в кавычках/скобках — тоже динамика
    .replace(/(["'`(])(\d{1,3})(["'`)])/g, "$1<num>$3")
    // кавычки схлопываем
    .replace(/["'`]/g, "")
    // пробелы
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface FingerprintInput {
  component: string;
  errorCode?: string | null;
  message: string;
  route?: string | null;
}

/**
 * Вычислить fingerprint (sha-256 hex, 40 символов — первые 40).
 */
export function computeFingerprint(input: FingerprintInput): string {
  const normalized = [
    input.component || "unknown",
    input.errorCode || "",
    normalizeMessage(input.message || ""),
    // route без динамических сегментов-чисел/UUID
    (input.route || "").replace(/[0-9a-f-]{8,}/gi, "<seg>").toLowerCase(),
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex").slice(0, 40);
}
