// ============================================================
// Конфигурация загрузки файлов для «Уездный кондитер»
// ============================================================

export type UploadCategory =
  | "avatars/users"
  | "avatars/confectioners"
  | "avatars/suppliers"
  | "avatars/couriers"
  | "avatars/venues"
  | "works"
  | "products"
  | "fillings"
  | "decor"
  | "venues"
  | "services"
  | "recipes"
  | "certificates"
  | "documents";

export interface UploadConfig {
  category: UploadCategory;
  maxFileSize: number; // в байтах
  allowedMimeTypes: string[];
  maxWidth: number;
  maxHeight: number;
  quality: number; // 0-100 для JPEG
  generateThumbnail: boolean;
  thumbnailSize?: number;
}

export const UPLOAD_CONFIGS: Record<UploadCategory, UploadConfig> = {
  "avatars/users": {
    category: "avatars/users",
    maxFileSize: 2 * 1024 * 1024, // 2 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 512,
    maxHeight: 512,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 128,
  },
  "avatars/confectioners": {
    category: "avatars/confectioners",
    maxFileSize: 3 * 1024 * 1024, // 3 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 800,
    maxHeight: 800,
    quality: 90,
    generateThumbnail: true,
    thumbnailSize: 200,
  },
  "avatars/suppliers": {
    category: "avatars/suppliers",
    maxFileSize: 3 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 800,
    maxHeight: 800,
    quality: 90,
    generateThumbnail: true,
    thumbnailSize: 200,
  },
  "avatars/couriers": {
    category: "avatars/couriers",
    maxFileSize: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 512,
    maxHeight: 512,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 128,
  },
  "avatars/venues": {
    category: "avatars/venues",
    maxFileSize: 3 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 800,
    maxHeight: 800,
    quality: 90,
    generateThumbnail: true,
    thumbnailSize: 200,
  },
  works: {
    category: "works",
    maxFileSize: 8 * 1024 * 1024, // 8 MB для работ
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 400,
  },
  products: {
    category: "products",
    maxFileSize: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 300,
  },
  fillings: {
    category: "fillings",
    maxFileSize: 3 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 800,
    maxHeight: 800,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 200,
  },
  decor: {
    category: "decor",
    maxFileSize: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 300,
  },
  venues: {
    category: "venues",
    maxFileSize: 8 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 400,
  },
  services: {
    category: "services",
    maxFileSize: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 300,
  },
  recipes: {
    category: "recipes",
    maxFileSize: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 300,
  },
  certificates: {
    category: "certificates",
    maxFileSize: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
    maxWidth: 1200,
    maxHeight: 1600,
    quality: 85,
    generateThumbnail: false,
  },
  documents: {
    category: "documents",
    maxFileSize: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
    maxWidth: 2000,
    maxHeight: 2000,
    quality: 85,
    generateThumbnail: false,
  },
};

// Валидация файла
export function validateFile(file: File, category: UploadCategory): {
  valid: boolean;
  error?: string;
} {
  const config = UPLOAD_CONFIGS[category];
  if (!config) return { valid: false, error: "Неизвестная категория" };

  if (file.size > config.maxFileSize) {
    const maxMB = (config.maxFileSize / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `Файл слишком большой (макс. ${maxMB} МБ)` };
  }

  if (!config.allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Недопустимый формат. Разрешены: ${config.allowedMimeTypes
        .map((t) => t.split("/")[1].toUpperCase())
        .join(", ")}`,
    };
  }

  return { valid: true };
}

// Генерация пути файла
export function generateFilePath(category: UploadCategory, fileExtension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const filename = `${timestamp}-${random}.${fileExtension}`;
  return `/uploads/${category}/${filename}`;
}

// Получение расширения из MIME типа
export function getExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  return map[mime] || "bin";
}

// Получение пути миниатюры
export function getThumbnailPath(originalPath: string): string {
  const parts = originalPath.split("/");
  const filename = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join("/");
  return `${dir}/thumb_${filename}`;
}
