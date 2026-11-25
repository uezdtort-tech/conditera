/** Shared detection of empty and template-only environment values. */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return (
    normalized.length === 0 ||
    /^(stub[-_]|change_me|fallback-|dev[-_]|build-placeholder|placeholder|example|dummy|your_|test[-_])/i.test(normalized)
  );
}

export function isConfiguredValue(value: string | null | undefined): boolean {
  return !isPlaceholderValue(value);
}
