/**
 * checkout-idempotency.ts — стабильный Idempotency-Key на ЛОГИЧЕСКУЮ отправку
 * checkout (U-07 fix, Release Gate v4.1; client-only, сервер не менялся).
 *
 * Контракт сервера (см. src/app/api/checkout/route.ts):
 *   - заголовок `Idempotency-Key` (валидация extractIdempotencyKey в
 *     lib/promo-codes.ts:274: 8..100 символов, [A-Za-z0-9._-]);
 *   - тот же ключ в окне 15 минут → replay СУЩЕСТВУЮЩЕГО заказа (200, тот же
 *     orderId, idempotentReplay:true), ключ хранится в orders.metadata
 *     .idempotency_key, гонка закрыта уникальным индексом 0060
 *     (supabase/migrations/0060_p11_hardening_integrity.sql:50-53);
 *   - ключ НЕ передан → создаётся новый заказ (opt-in контракт).
 *
 * Гарантия клиента («повтор той же логической отправки не создаёт дубль»):
 *   - ключ привязан к СИГНАТУРЕ ТЕЛА запроса (канонический stringify + FNV-1a),
 *     а не к монтированию компонента: retry после сетевого сбоя/таймаута
 *     (в т.ч. после remount/перезагрузки страницы — ключ живёт в
 *     sessionStorage) переиспользует ТОТ ЖЕ ключ → сервер вернёт replay;
 *   - исход УСТАНОВЛЕН (2xx — заказ создан; 4xx — сервер точно не создавал
 *     заказ: валидация/401/422/429) → ключ закрывается, следующая отправка
 *     (в т.ч. повторный заказ с той же корзиной) получает НОВЫЙ ключ —
 *     ложного replay второго заказа не бывает;
 *   - исход НЕИЗВЕСТЕН (сетевой сбой, 5xx/502 — заказ МОГ создаться) →
 *     ключ сохраняется до replay-подтверждения.
 */

const STORAGE_KEY = "checkout_idempotency_attempt_v1";

/** Исход попытки отправки checkout (определяет судьбу ключа). */
export type CheckoutAttemptOutcome = "success" | "rejected" | "unknown";

interface StoredAttempt {
  key: string;
  signature: string;
}

/** Фолбэк, когда sessionStorage недоступен (SSR/приватный режим). */
let memoryFallback: StoredAttempt | null = null;

function safeSessionStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== "undefined") {
      const probe = "__checkout_idem_probe__";
      sessionStorage.setItem(probe, "1");
      sessionStorage.removeItem(probe);
      return sessionStorage;
    }
  } catch {
    // приватный режим/отключённое хранилище — используем фолбэк в памяти
  }
  return null;
}

/** Ключ в формате, который принимает серверный extractIdempotencyKey. */
function isValidKeyShape(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length >= 8 &&
    key.length <= 100 &&
    /^[A-Za-z0-9._-]+$/.test(key)
  );
}

/** UUID, с фолбэком для сред без crypto.randomUUID (символы — [A-Za-z0-9_-]). */
export function makeCheckoutIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Канонизация: рекурсивная сортировка ключей; undefined-поля не значимы. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] !== undefined) out[k] = canonicalize(src[k]);
    }
    return out;
  }
  return value;
}

/**
 * Сигнатура тела запроса: канонический JSON + FNV-1a (32 бита, hex) + длина.
 * Хеш вместо полного тела — чтобы не дублировать контактные PII в
 * sessionStorage; коллизия FNV-1a + длины для практических тел невозможна,
 * а её цена — лишь ложный replay в пределах одной неразрешённой попытки.
 */
export function computeCheckoutSubmissionSignature(body: unknown): string {
  const json = JSON.stringify(canonicalize(body)) ?? "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}:${json.length.toString(36)}`;
}

function readStoredAttempt(storage: Storage | null): StoredAttempt | null {
  if (storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredAttempt;
      if (parsed && isValidKeyShape(parsed.key) && typeof parsed.signature === "string") {
        return parsed;
      }
    } catch {
      // мусор в хранилище — трактуем как отсутствие попытки
    }
    return null;
  }
  return memoryFallback;
}

/**
 * Начать/продолжить логическую отправку checkout.
 *   - та же сигнатура тела при НЕзакрытой прошлой попытке → ТОТ ЖЕ ключ
 *     (reused:true) — retry/timeout-retry вернёт replay того же заказа;
 *   - новая сигнатура (изменили корзину/контакты) или прошлый исход известен
 *     → НОВЫЙ ключ.
 */
export function beginCheckoutIdempotencyAttempt(body: unknown): { key: string; reused: boolean } {
  const signature = computeCheckoutSubmissionSignature(body);
  const storage = safeSessionStorage();
  const stored = readStoredAttempt(storage);

  if (stored && stored.signature === signature) {
    return { key: stored.key, reused: true };
  }

  const key = makeCheckoutIdempotencyKey();
  const next: StoredAttempt = { key, signature };
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // переполнение квоты — ключ всё равно живёт в памяти текущей страницы
    }
  }
  memoryFallback = next;
  return { key, reused: false };
}

/**
 * Зафиксировать исход попытки:
 *   - "success"  (2xx, заказ создан)     → ключ закрывается: следующая
 *     отправка — НОВАЯ логическая (ложный replay невозможен);
 *   - "rejected" (4xx, заказ точно НЕ создан) → ключ закрывается;
 *   - "unknown"  (сетевой сбой/таймаут/5xx — заказ МОГ создаться) → ключ
 *     остаётся: повтор той же отправки получит replay того же заказа.
 * Идемпотентно: не трогает попытку, если хранилище уже принадлежит более
 * новой (например, ключ закрыли и начали новую отправку).
 */
export function resolveCheckoutIdempotencyAttempt(key: string, outcome: CheckoutAttemptOutcome): void {
  if (outcome === "unknown") return;
  const storage = safeSessionStorage();
  if (storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StoredAttempt;
      if (parsed && parsed.key === key) storage.removeItem(STORAGE_KEY);
    } catch {
      // не наша запись — ничего не делаем
    }
    return;
  }
  if (memoryFallback && memoryFallback.key === key) memoryFallback = null;
}
