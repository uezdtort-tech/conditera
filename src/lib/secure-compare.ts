import crypto from "node:crypto";

/**
 * Timing-safe сравнение строковых секретов (защита от timing-атак).
 * Используется в webhook-роутах и служебных endpoint'ах с shared-secret auth.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
