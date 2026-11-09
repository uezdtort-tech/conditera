// Timing-safe сравнение строк (constant-time).
//
// Используется для сверки OAuth `state` (query) с httpOnly-cookie в
// /api/auth/oauth/[provider]/callback. Обычное `a === b` выходит рано при
// несовпадении первого байта и утечёт длину — это даёт оракул для побайтового
// подбора state. Здесь длина проверяется явно (длина state не секрет — 64 hex
// символа от randomBytes(32)), а само сравнение выполняется за константное
// время через crypto.timingSafeEqual.
//
// RELEASE-02 §6 (см. коммит d43d029, восстановлен в RELEASE-03 Conditera).

import { timingSafeEqual } from "crypto";

export function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  // Разная длина → сравнить нечего; длина не секретна, ранний выход безопасен.
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
