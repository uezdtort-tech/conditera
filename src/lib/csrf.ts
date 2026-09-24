// src/lib/csrf.ts
// CSRF protection using double-submit cookie pattern

import { createHash, randomBytes } from 'crypto';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export function validateCsrfToken(cookieToken: string | null, headerToken: string | null): boolean {
  if (!cookieToken || !headerToken) return false;
  // Use timing-safe comparison
  try {
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    if (a.length !== b.length) return false;
    return a.equals(b);
  } catch {
    return false;
  }
}

export function shouldCheckCsrf(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
