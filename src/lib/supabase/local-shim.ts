/**
 * Gate for the in-app Supabase compatibility shims.
 *
 * Production must use the real single-container Supabase runtime through
 * Caddy/Kong (/api/auth|rest|storage/v1). Local Next.js shims exist only for
 * development and explicit CI integration tests; exposing them on the
 * production origin would create a second, weaker API surface.
 */
export function isLocalSupabaseShimAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.CI === "true" && env.SUPABASE_LOCAL_SHIMS_ENABLED === "true";
}
