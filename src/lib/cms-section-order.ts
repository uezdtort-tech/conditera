export interface CmsSectionOrderInput {
  slug: string;
  title?: string;
  sortOrder: number;
  visible: boolean;
}

export function normalizeCmsSectionOrder(input: unknown): CmsSectionOrderInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) return null;
  const normalized: CmsSectionOrderInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.slug !== "string" || !/^[a-z0-9][a-z0-9_-]{0,59}$/i.test(row.slug)) return null;
    if (!Number.isInteger(row.sortOrder) || Number(row.sortOrder) < 0 || Number(row.sortOrder) > 10000) return null;
    if (typeof row.visible !== "boolean") return null;
    const title = row.title === undefined ? undefined : typeof row.title === "string" ? row.title.trim() : null;
    if (title === null || (title !== undefined && (title.length < 1 || title.length > 100))) return null;
    normalized.push({
      slug: row.slug,
      ...(title === undefined ? {} : { title }),
      sortOrder: Number(row.sortOrder),
      visible: row.visible,
    });
  }
  if (new Set(normalized.map((row) => row.slug)).size !== normalized.length) return null;
  if (new Set(normalized.map((row) => row.sortOrder)).size !== normalized.length) return null;
  return normalized.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}
