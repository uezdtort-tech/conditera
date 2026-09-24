/**
 * Скрипт миграции внешних изображений (unsplash, pravatar) в локальные.
 *
 * Сканирует mock-data.ts, находит URL unsplash.com и pravatar.cc,
 * скачивает изображения, оптимизирует через sharp, сохраняет в public/uploads/.
 *
 * Запуск: bun run scripts/migrate-external-images.ts
 */
import { writeFile, mkdir, readFile, writeFile as writeFileAtomic } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

const MOCK_DATA_PATH = join(process.cwd(), "src", "lib", "mock-data.ts");
const UPLOAD_BASE = join(process.cwd(), "public", "uploads");

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
  mappings: Record<string, string>;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[migrate] download failed: ${url} — ${msg}`);
    return null;
  }
}

async function optimizeImage(buffer: Buffer, category: string): Promise<{ main: Buffer; thumb: Buffer }> {
  const main = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
    .stripMetadata()
    .webp({ quality: 80 })
    .toBuffer();

  const thumb = await sharp(buffer)
    .resize(300, 300, { fit: "cover" })
    .stripMetadata()
    .webp({ quality: 70 })
    .toBuffer();

  return { main, thumb };
}

function getCategoryFromUrl(url: string): string {
  if (url.includes("pravatar")) return "avatars";
  if (url.includes("unsplash")) {
    // Пытаемся определить категорию по контексту URL
    if (url.includes("cake") || url.includes("dessert") || url.includes("food")) return "products";
    if (url.includes("person") || url.includes("portrait")) return "avatars";
    return "products";
  }
  return "temp";
}

async function migrateExternalImages(): Promise<MigrationResult> {
  const result: MigrationResult = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    mappings: {},
  };

  console.log("📖 Чтение mock-data.ts...");
  const content = await readFile(MOCK_DATA_PATH, "utf-8");

  // Находим все URL unsplash и pravatar
  const urlRegex = /https:\/\/(?:images\.unsplash\.com\/[^\s"'`)]+|i\.pravatar\.cc\/[^\s"'`)]+)/g;
  const urls = [...new Set(content.match(urlRegex) || [])];

  result.total = urls.length;
  console.log(`🔍 Найдено ${urls.length} уникальных внешних URL`);

  for (const url of urls) {
    // Пропускаем уже мигрированные
    if (result.mappings[url]) {
      result.skipped++;
      continue;
    }

    const category = getCategoryFromUrl(url);
    const categoryDir = join(UPLOAD_BASE, category);
    await mkdir(categoryDir, { recursive: true });

    console.log(`⬇️  Скачивание: ${url.substring(0, 60)}...`);
    const buffer = await downloadImage(url);

    if (!buffer) {
      console.warn(`❌ Не удалось скачать: ${url}`);
      result.errors++;
      continue;
    }

    try {
      const baseName = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const filename = `${baseName}.webp`;
      const thumbFilename = `${baseName}_thumb.webp`;
      const filePath = join(categoryDir, filename);
      const thumbPath = join(categoryDir, thumbFilename);
      const publicUrl = `/uploads/${category}/${filename}`;

      const { main, thumb } = await optimizeImage(buffer, category);

      await writeFile(filePath, main);
      await writeFile(thumbPath, thumb);

      result.mappings[url] = publicUrl;
      result.migrated++;
      console.log(`✅ ${url.substring(0, 40)}... → ${publicUrl}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`❌ Ошибка оптимизации: ${url} — ${msg}`);
      result.errors++;
    }

    // Небольшая задержка чтобы не перегружать серверы
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Заменяем URL в файле
  if (result.migrated > 0) {
    console.log("\n📝 Замена URL в mock-data.ts...");
    let newContent = content;
    for (const [oldUrl, newUrl] of Object.entries(result.mappings)) {
      // Экранируем специальные символы в URL для regex
      const escapedUrl = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      newContent = newContent.replace(new RegExp(escapedUrl, "g"), newUrl);
    }
    await writeFileAtomic(MOCK_DATA_PATH, newContent, "utf-8");
    console.log(`✅ Заменено ${result.migrated} URL в mock-data.ts`);
  }

  console.log(`\n📊 Итог:`);
  console.log(`   Всего URL: ${result.total}`);
  console.log(`   Мигрировано: ${result.migrated}`);
  console.log(`   Пропущено: ${result.skipped}`);
  console.log(`   Ошибок: ${result.errors}`);

  return result;
}

// Запуск
migrateExternalImages().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
