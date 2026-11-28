/**
 * True for empty values and common non-production placeholders used in env
 * templates. Keep this shared by OAuth initiation, callbacks and status UI so
 * a template value can never be mistaken for a configured provider.
 */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return (
    normalized.length === 0 ||
    /^(stub_|change_me|fallback-|dev[-_]|placeholder|example|dummy|test[-_])/i.test(normalized)
  );
}

export function isConfiguredValue(value: string | null | undefined): boolean {
  return !isPlaceholderValue(value);
}
