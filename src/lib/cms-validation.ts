const CMS_SLUG_PATTERN = /^[a-z0-9а-яё]+(?:-[a-z0-9а-яё]+)*$/u;

export function isSafeCmsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const candidate = value.trim();
  if (!candidate) return false;
  if (candidate.startsWith("/")) {
    if (candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) return false;
    try {
      return new URL(candidate, "https://conditera.invalid").origin === "https://conditera.invalid";
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function isValidCmsSlug(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    CMS_SLUG_PATTERN.test(value);
}

export type CmsPageInput = {
  slug?: string;
  title?: string;
  description?: string | null;
  content?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[] | null;
  isInMenu?: boolean;
  menuOrder?: number;
  status?: "draft" | "published";
};

export function validateCmsPageInput(
  value: unknown,
  partial = false,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Некорректный формат страницы";
  }
  const body = value as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  if (!partial || has("slug")) {
    if (!isValidCmsSlug(body.slug)) return "Slug должен содержать строчные латинские или русские буквы, цифры и дефисы";
  }
  if (!partial || has("title")) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 180) {
      return "Заголовок обязателен и не должен превышать 180 символов";
    }
  }
  if (!partial || has("content")) {
    if (typeof body.content !== "string" || body.content.length > 100000) {
      return "Содержимое обязательно и не должно превышать 100000 символов";
    }
  }
  for (const [key, max] of [["description", 1000], ["seoTitle", 180], ["seoDescription", 320]] as const) {
    if (has(key) && body[key] !== null &&
      (typeof body[key] !== "string" || body[key].length > max)) {
      return `Поле ${key} имеет некорректный формат или превышает ${max} символов`;
    }
  }
  if (has("seoKeywords") && body.seoKeywords !== null &&
    (!Array.isArray(body.seoKeywords) || body.seoKeywords.length > 30 ||
      body.seoKeywords.some((item) => typeof item !== "string" || item.length > 80))) {
    return "SEO keywords должны быть массивом из не более 30 строк длиной до 80 символов";
  }
  if (has("isInMenu") && typeof body.isInMenu !== "boolean") return "isInMenu должен быть boolean";
  if (has("menuOrder") && (!Number.isInteger(body.menuOrder) || Number(body.menuOrder) < 0 || Number(body.menuOrder) > 10000)) {
    return "menuOrder должен быть целым числом от 0 до 10000";
  }
  if (has("status") && body.status !== "draft" && body.status !== "published") {
    return "Допустимые статусы: draft, published";
  }
  return null;
}

const CMS_MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

export function getSafeCmsMediaExtension(mimeType: unknown): string | null {
  return typeof mimeType === "string" ? CMS_MEDIA_EXTENSIONS[mimeType] ?? null : null;
}

export function hasValidCmsMediaSignature(mimeType: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  switch (mimeType) {
    case "image/jpeg": return starts(0xff, 0xd8, 0xff);
    case "image/png": return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/gif": return starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "video/mp4":
      return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    case "video/webm": return starts(0x1a, 0x45, 0xdf, 0xa3);
    case "audio/mpeg":
      return starts(0x49, 0x44, 0x33) || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case "audio/wav":
      return starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
    case "application/pdf": return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    default: return false;
  }
}
