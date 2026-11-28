/** Reject absent, placeholder and demo Supabase credentials. */
export function isPlaceholderSupabaseKey(
  value: string | undefined,
  allowDevelopmentKeys = false
): boolean {
  const key = value?.trim();
  if (!key) return true;
  if (/^(stub[-_]|change_me|fallback-|build-placeholder|dummy|your_|example|placeholder|test[-_])/i.test(key)) return true;
  if (!allowDevelopmentKeys && /^dev[-_]/i.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    return !allowDevelopmentKeys && (claims.iss === "supabase-demo" || claims.ref === "demo");
  } catch {
    return false;
  }
}
