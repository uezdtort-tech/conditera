/**
 * confectioner-assignment.ts — назначение кондитера custom-позициям
 * конструктора тортов при checkout (POST /api/checkout).
 *
 * FK-контракт (проверено по live-БД и supabase/migrations/0002_marketplace.sql):
 *   orders.confectioner_id   UUID NULLABLE → auth.users(id) ON DELETE RESTRICT
 *   products.confectioner_id UUID          → auth.users(id) ON DELETE CASCADE
 *
 * Профиль кондитера — таблица `confectioners` (таблицы confectioner_profiles
 * НЕ существует): confectioners.id TEXT (в dev-сидах 'c0'..'c4'),
 * confectioners.userId TEXT — id пользователя (auth.users).
 *
 * Клиент (конструктор, шаг «Резюме») передаёт confectioners.id — его нельзя
 * доверять: валидация ЗДЕСЬ, на сервере. В orders.confectioner_id пишем
 * profile.userId (id пользователя), иначе FK orders_confectioner_id_fkey
 * отвергнет вставку. Любая ошибка → null + console.warn в вызвающем коде:
 * заказ создаётся и без назначения (никогда не роняем checkout).
 */

import { z } from "zod";

/** Минимальный снимок строки confectioners, нужный для решения. */
export interface ConfectionerProfileRow {
  id?: unknown;
  userId?: unknown;
  verified?: unknown;
}

export type CustomConfectionerResolution =
  | { ok: true; /** id пользователя кондитера (auth.users) — в orders.confectioner_id */ confectionerId: string }
  | {
      ok: false;
      reason: "missing_profile" | "unverified" | "bad_user_id";
    };

/** Человекочитаемая причина отказа — для console.warn в route handler. */
export const CUSTOM_CONFECTIONER_REASON_RU: Record<
  Exclude<CustomConfectionerResolution, { ok: true }>["reason"],
  string
> = {
  missing_profile: "профиль кондитера не найден",
  unverified: "профиль не верифицирован",
  bad_user_id: "у профиля нет корректного userId (auth.users)",
};

/**
 * Zod/UUID-формат-страж: вызывается ДО любого запроса к БД. Mock/dev-сид
 * кондитеров использует не-UUID id ('c1', 'u2') — они отсекаются дёшево,
 * без похода в базу (fallback: confectioner_id = null + warn).
 */
export function isUuidLike(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}

/**
 * Решение по ОДНОЙ custom-позиции (чистая функция, без БД и side effects).
 *
 * @param profRow  строка confectioners из БД (или null — не найдена)
 * @param _itemRef метка позиции для сообщений/логов вызывающего кода
 * @returns ok + userId кондитера (auth.users) — либо причина отказа
 */
export function resolveCustomConfectioner(
  profRow: ConfectionerProfileRow | null | undefined,
  _itemRef?: string
): CustomConfectionerResolution {
  if (!profRow || typeof profRow !== "object") {
    return { ok: false, reason: "missing_profile" };
  }
  // Верификация — строго boolean true (админ-модерация, verificationStatus='approved').
  if (profRow.verified !== true) {
    return { ok: false, reason: "unverified" };
  }
  // В orders.confectioner_id (UUID → auth.users) годится только UUID userId.
  const uid = profRow.userId;
  if (typeof uid !== "string" || !isUuidLike(uid)) {
    return { ok: false, reason: "bad_user_id" };
  }
  return { ok: true, confectionerId: uid };
}
