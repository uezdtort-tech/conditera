#!/usr/bin/env node
/**
 * scripts/db/seed-product-media.mjs — демо-медиа карточки товара (Task 2-a).
 *
 * Вызывается из setup.mjs в цикле сидов как .mjs-сид:
 *   const mod = await import(pathToFileURL(seedFile).href);
 *   await mod.default({ client, ROOT });
 *
 * Контракт:
 *   - экспорт default async ({ client, ROOT });
 *   - НЕ открывает свою транзакцию — обёртка setup.mjs делает BEGIN/COMMIT;
 *   - идемпотентен: фиксированные UUID + INSERT ... ON CONFLICT (id) DO NOTHING,
 *     файлы копируются только если их ещё нет (existsSync);
 *   - безопасен на пустой БД (нет товаров — тихий return).
 *
 * Данные:
 *   - демо-товар №1 (slug LIKE 'deserty-portSIONnyye-20'): 3 approved-фото
 *     (первая — обложка, sort_order 10/20/30) + 1 pending-фото для очереди
 *     модерации; файлы кладутся в <ROOT>/storage/products/<productId>/published/photos/;
 *   - второй published-товар выбирается для будущих расширений сида (без медиа).
 */

import {
  mkdirSync,
  copyFileSync,
  existsSync,
  statSync,
} from "node:fs";
import path from "node:path";

// Фиксированные UUID (version-4 по формату: 4aaa / 8aaa) — идемпотентность сида
const MEDIA_UUIDS = {
  photo1: "aaaaaaaa-aaaa-4aaa-8aaa-00000000f001",
  photo2: "aaaaaaaa-aaaa-4aaa-8aaa-00000000f002",
  photo3: "aaaaaaaa-aaaa-4aaa-8aaa-00000000f003",
  photo4Pending: "aaaaaaaa-aaaa-4aaa-8aaa-00000000f004",
};

// Демо-фото из public/uploads/products/ (коммитятся в git)
const SOURCE_PNGS = {
  photo1: "deserty-portionnyye-20.png", // «родное» фото товара → обложка
  photo2: "kapkeyki-vanilnyye-12.png",
  photo3: "makarons-assorti-15.png",
  photo4Pending: "tort-napoleon-domashniy.png",
};

export default async function seedProductMedia({ client, ROOT }) {
  // 1. Демо-товар №1 (портционные десерты из seed_vitrine)
  const first = await client.query(
    `SELECT id::text, slug FROM public.products WHERE slug LIKE 'deserty-portSIONnyye-20' LIMIT 1`
  );
  if (first.rowCount === 0) {
    console.log("    product-media: товары не найдены — сид пропущен (пустая БД)");
    return;
  }
  const product = first.rows[0]; // { id, slug }

  // 2. Любой второй published-товар (задел под будущие демо-медиа)
  const second = await client.query(
    `SELECT id::text, slug FROM public.products WHERE status = 'published' AND id <> $1::uuid LIMIT 1`,
    [product.id]
  );
  const secondSlug = second.rowCount > 0 ? second.rows[0].slug : null;

  // 3. Копирование файлов: <ROOT>/storage/products/<productId>/published/photos/
  const destDir = path.join(
    ROOT,
    "storage",
    "products",
    product.id,
    "published",
    "photos"
  );
  mkdirSync(destDir, { recursive: true });

  const mediaRows = [
    { key: "photo1", sortOrder: 10, status: "approved", isCover: true },
    { key: "photo2", sortOrder: 20, status: "approved", isCover: false },
    { key: "photo3", sortOrder: 30, status: "approved", isCover: false },
    { key: "photo4Pending", sortOrder: 40, status: "pending", isCover: false },
  ];

  let copied = 0;
  let skippedFiles = 0;
  for (const m of mediaRows) {
    // Имена файлов: 01_<uuid>.png, 02_<uuid>.png, 03_<uuid>.png, 04_<uuid>.png
    const seq = { photo1: "01", photo2: "02", photo3: "03", photo4Pending: "04" }[m.key];
    const uuid = MEDIA_UUIDS[m.key];
    const finalName = `${seq}_${uuid}.png`;

    const src = path.join(ROOT, "public", "uploads", "products", SOURCE_PNGS[m.key]);
    const dest = path.join(destDir, finalName);
    let fileSize;
    if (existsSync(dest)) {
      fileSize = statSync(dest).size; // повторный запуск: файл уже скопирован
      skippedFiles++;
    } else {
      copyFileSync(src, dest);
      fileSize = statSync(dest).size;
      copied++;
    }
    m.fileName = finalName;
    m.fileSize = fileSize;
    m.destPath = dest;
  }

  // 4. Строки product_media (ON CONFLICT (id) DO NOTHING — идемпотентно).
  //    storage_path — относительно <ROOT>/storage/.
  let inserted = 0;
  for (const m of mediaRows) {
    const uuid = MEDIA_UUIDS[m.key];
    const res = await client.query(
      `INSERT INTO public.product_media
         (id, product_id, media_type, storage_path, original_filename, mime_type,
          file_size, width, height, sort_order, status, is_cover, uploaded_by)
       VALUES ($1::uuid, $2::uuid, 'photo', $3, $4, 'image/png',
               $5::int, 1200, 900, $6::int, $7, $8::boolean, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        uuid,
        product.id,
        `products/${product.id}/published/photos/${m.fileName}`,
        SOURCE_PNGS[m.key],
        m.fileSize,
        m.sortOrder,
        m.status,
        m.isCover,
      ]
    );
    inserted += res.rowCount;
  }

  console.log(
    `    product-media: product=${product.slug}, rows inserted=${inserted} (4 total), ` +
      `files copied=${copied}, files kept=${skippedFiles}` +
      (secondSlug ? `, second product available: ${secondSlug}` : "")
  );
}
