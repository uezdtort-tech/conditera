/**
 * product-media/storage.ts — файловый слой товарных медиа (Task 2-b).
 *
 * Файлы живут на диске относительно STORAGE_ROOT (по умолчанию
 * <project>/storage, каталог в .gitignore, сид 2-a кладёт демо туда же):
 *
 *   products/<productId>/<stage: pending|published>/<photos|videos>/<NN>_<uuid><ext>
 *
 * Все пути из БД (storage_path) ОБЯЗАНЫ проходить через absMediaPath() —
 * он резолвит путь против корня и блокирует выход за его пределы
 * (защита от подменённой строки storage_path / path traversal).
 *
 * Все операции — nodejs-runtime only (route handlers с runtime = "nodejs").
 */

import { randomUUID } from "crypto";
import { promises as fsp } from "fs";
import path from "path";

/**
 * Корень хранилища товарных медиа.
 * PRODUCT_MEDIA_ROOT позволяет вынести каталог (docker volume и т.п.).
 */
export const STORAGE_ROOT: string =
  process.env.PRODUCT_MEDIA_ROOT || path.join(process.cwd(), "storage");

/** Ошибка storage-слоя (path traversal и т.п.). Маппится в 500 INTERNAL_ERROR. */
export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

type Stage = "pending" | "published";
type MediaType = "photo" | "video";

const STAGE_DIR_BY_TYPE: Record<MediaType, string> = {
  photo: "photos",
  video: "videos",
};

/**
 * Абсолютный путь по относительному (storage_path из БД).
 * Гарантирует, что результат лежит строго внутри STORAGE_ROOT.
 * Иначе — console.warn + MediaStorageError("path traversal blocked").
 */
export function absMediaPath(relPath: string): string {
  const root = path.resolve(STORAGE_ROOT);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    console.warn(
      `[product-media/storage] path traversal blocked: rel="${relPath.slice(0, 300)}" → abs="${abs}" (root="${root}")`
    );
    throw new MediaStorageError("path traversal blocked");
  }
  return abs;
}

export interface BuildRelativePathArgs {
  productId: string;
  stage: Stage;
  mediaType: MediaType;
  /** расширение с точкой (".png") или без ("png") — приходит из sniffMime */
  ext: string;
  /** порядковый номер (для человекочитаемого префикса NN_) */
  seq: number;
}

/**
 * Имя файла на диске — ТОЛЬКО генерированное:
 *   products/<pid>/<stage>/<photos|videos>/<NN>_<uuid><ext>
 * Оригинальное имя клиента хранится в БД (original_filename).
 */
export function buildRelativePath({
  productId,
  stage,
  mediaType,
  ext,
  seq,
}: BuildRelativePathArgs): string {
  const dir = STAGE_DIR_BY_TYPE[mediaType];
  const nn = String(Math.max(0, Math.floor(seq))).padStart(2, "0");
  const safeExt = ext.startsWith(".") ? ext : `.${ext}`;
  return `products/${productId}/${stage}/${dir}/${nn}_${randomUUID()}${safeExt}`;
}

/**
 * Атомарная запись: tmp-файл рядом + rename (читатель никогда не видит
 * наполовину записанный файл).
 */
export async function writeFileAtomic(
  absPath: string,
  data: Buffer
): Promise<void> {
  const dir = path.dirname(absPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now().toString(36)}.tmp`
  );
  const handle = await fsp.open(tmp, "w");
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tmp, absPath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Перемещение файла между stage-каталогами (pending → published) в рамках
 * одного диска: mkdir -p под цель + fs.rename.
 */
export async function moveToStage(
  fromRel: string,
  toRel: string
): Promise<void> {
  const from = absMediaPath(fromRel);
  const to = absMediaPath(toRel);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
}

/**
 * Тихое удаление файла. false — файла не было (ENOENT);
 * остальные ошибки логируются в warn, но не бросаются (не должны ронять API).
 */
export async function removeFileQuiet(absPath: string): Promise<boolean> {
  try {
    await fsp.unlink(absPath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return false;
    console.warn(
      `[product-media/storage] removeFileQuiet failed for "${absPath}":`,
      (err as Error | null)?.message ?? err
    );
    return false;
  }
}

/**
 * Создать стандартное дерево каталогов товара
 * (pending/published × photos/videos).
 */
export async function ensureProductDirs(productId: string): Promise<void> {
  const base = path.join(path.resolve(STORAGE_ROOT), "products", productId);
  await Promise.all([
    fsp.mkdir(path.join(base, "pending", "photos"), { recursive: true }),
    fsp.mkdir(path.join(base, "pending", "videos"), { recursive: true }),
    fsp.mkdir(path.join(base, "published", "photos"), { recursive: true }),
    fsp.mkdir(path.join(base, "published", "videos"), { recursive: true }),
  ]);
}

/**
 * Переставить stage-сегмент в относительном пути
 * products/<pid>/<stage>/<dir>/<file> → новый stage.
 * Возвращает null, если путь не соответствует каноничному формату
 * (например, сид-файл уже лежит в published при status=pending —
 * тогда переносить нечего/некуда).
 */
export function switchStageInPath(
  relPath: string,
  toStage: Stage
): string | null {
  const parts = relPath.split("/");
  if (
    parts.length === 5 &&
    parts[0] === "products" &&
    parts[1].length > 0 &&
    (parts[2] === "pending" || parts[2] === "published") &&
    (parts[3] === "photos" || parts[3] === "videos") &&
    parts[4].length > 0
  ) {
    parts[2] = toStage;
    return parts.join("/");
  }
  return null;
}
