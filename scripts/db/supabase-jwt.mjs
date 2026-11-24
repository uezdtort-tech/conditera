import crypto from "node:crypto";

/**
 * Generate a local Supabase-compatible HS256 JWT for anon/service_role.
 * This is for the local embedded runtime and CI only; production keys must
 * come from the configured Supabase runtime and must never be generated here.
 */
export function generateSupabaseJwt(role, secret) {
  if (!["anon", "service_role"].includes(role)) {
    throw new Error("Unsupported local Supabase JWT role.");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  }

  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({
    role,
    iss: "local",
    iat: now,
    exp: now + 10 * 365 * 24 * 3600,
  }));
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}
