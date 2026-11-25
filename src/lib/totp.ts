/**
 * TOTP (Time-based One-Time Password) — RFC 6238.
 *
 * Используется для 2FA кондитеров при выплатах и критичных операциях.
 *
 * Реализация на встроенном Node.js crypto — без внешних зависимостей
 * (otplib тянет много кода, нам нужен только TOTP/HOTP).
 *
 * Совместимо с Google Authenticator, Authy, 1Password и другими.
 *
 * Алгоритм:
 *  1. Генерируем случайный 20-байтовый секрет, кодируем в base32
 *  2. Показываем пользователю otpauth:// URI для QR-кода
 *  3. Приложение генерирует 6-значный код каждые 30 секунд
 *  4. Сервер валидирует код, сравнивая HMAC-SHA1(secret, time/30)
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// ===== Base32 (RFC 4648) =====
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return result;
}

export function base32Decode(str: string): Buffer {
  const cleaned = str.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ===== Секреты: шифрование для хранения в БД =====
// Храним не raw base32-секрет, а зашифрованный AES-256-GCM.
// Ключ — отдельный от JWT, в env TFA_ENCRYPTION_KEY.
import { createCipheriv, createDecipheriv, scryptSync } from "crypto";

// === КРИТИЧНО: ключ шифрования TOTP-секретов ===
function getTfaKey(): string {
  const value = process.env.TFA_ENCRYPTION_KEY;
  if (!value) {
    console.warn("⚠️ TFA_ENCRYPTION_KEY не задана — dev-ключ. НЕ для production!");
    return "dev_tfa_key_change_me_in_production_aaaaaaaaaaaaaaaaaaaaaaaa";
  }
  if (process.env.NODE_ENV === "production" &&
      (value.startsWith("CHANGE_ME") || value.startsWith("dev_"))) {
    console.error("⚠️ КРИТИЧНО: TFA_ENCRYPTION_KEY содержит заглушку в production!");
  }
  return value;
}

const TFA_KEY = scryptSync(getTfaKey(), "conditera-salt", 32);

export function encryptSecret(base32Secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", TFA_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(base32Secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Формат: iv:tag:ciphertext — всё в base64
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(encrypted: string): string {
  const [ivB64, tagB64, dataB64] = encrypted.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", TFA_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// ===== Генерация нового секрета =====
export function generateTfaSecret(): string {
  // 20 байт = 160 бит — стандартный размер TOTP-секрета
  return base32Encode(randomBytes(20));
}

// ===== otpauth:// URI для QR-кода =====
export function buildOtpAuthUri(opts: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = opts.issuer || "Кондитера";
  const label = encodeURIComponent(`${issuer}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ===== TOTP generation / validation =====
function hotp(secret: Buffer, counter: number): number {
  const buf = Buffer.alloc(8);
  // counter — 64-bit big-endian
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return code;
}

export function generateTotp(secret: string, atTime?: number): string {
  const time = atTime ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / 30);
  const secretBuf = base32Decode(secret);
  return hotp(secretBuf, counter).toString().padStart(6, "0");
}

/**
 * Проверить TOTP-код с допуском ±1 шаг (±30 секунд).
 * Защищена от timing-атаки через timingSafeEqual.
 */
export function verifyTotp(
  token: string,
  secret: string,
  atTime?: number,
  window: number = 1
): boolean {
  if (!/^\d{6}$/.test(token)) return false;

  const time = atTime ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / 30);
  const secretBuf = base32Decode(secret);

  // Проверяем текущий шаг и ±window шагов (по умолчанию ±30 секунд)
  for (let offset = -window; offset <= window; offset++) {
    const expected = hotp(secretBuf, counter + offset).toString().padStart(6, "0");
    if (timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

// ===== Backup codes =====
/**
 * Генерация 10 одноразовых backup-кодов в формате XXXX-XXXX.
 * Возвращает массив кодов в plain text (для показа пользователю один раз)
 * и массив их SHA-256 хэшей (для хранения в БД).
 */
export function generateBackupCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code =
      randomBytes(2).toString("hex").toUpperCase() +
      "-" +
      randomBytes(2).toString("hex").toUpperCase();
    codes.push(code);
    hashes.push(hashBackupCode(code));
  }
  return { codes, hashes };
}

export function hashBackupCode(code: string): string {
  return createHmac("sha256", TFA_KEY).update(code).digest("hex");
}

export function verifyBackupCode(
  code: string,
  hashes: string[]
): boolean {
  const hash = hashBackupCode(code.toUpperCase());
  return hashes.some((h) => timingSafeEqual(Buffer.from(hash), Buffer.from(h)));
}
