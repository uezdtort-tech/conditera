export function isSafeCmsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const candidate = value.trim();
  if (!candidate) return false;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return true;
  try {
    return new URL(candidate).protocol === "https:";
  } catch {
    return false;
  }
}
