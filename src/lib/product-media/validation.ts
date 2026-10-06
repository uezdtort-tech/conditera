/**
 * product-media/validation.ts — валидация содержимого медиа-файлов (Task 2-b).
 *
 * Принципы:
 *  - НИКОГДА не доверяем client-заголовку Content-Type файла — только
 *    сниффер магических байтов (sniffMime);
 *  - SVG и всё прочее, кроме перечисленного, — запрет (SVG = XSS-вектор);
 *  - фото дополнительно проверяются sharp'ом (реальные размеры/формат);
 *  - видео — best-effort парсинг MP4-boxes (mvhd: длительность,
 *    tkhd: размеры); битые файлы не должны ронять загрузку.
 */

import sharp from "sharp";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024; // 64 MB
export const MAX_VIDEO_SECONDS = 900;
export const MAX_IMAGE_DIM = 8000;

/**
 * Ошибка валидации содержимого файла. status — HTTP-статус для ответа,
 * code — код ошибки API-контракта (UNSUPPORTED_MEDIA_TYPE / VALIDATION_FAILED).
 */
export class MediaValidationError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MediaValidationError";
    this.status = status;
    this.code = code;
  }
}

export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_MIMES = ["video/mp4", "video/webm"] as const;

export type PhotoMime = (typeof PHOTO_MIMES)[number];
export type VideoMime = (typeof VIDEO_MIMES)[number];

export interface SniffedMime {
  mime: string;
  ext: string;
}

/**
 * Определить реальный MIME по магическим байтам.
 * Возвращает null для всего нераспознанного (в т.ч. SVG, GIF, AVI, MKV...).
 */
export function sniffMime(buffer: Buffer): SniffedMime | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: ".jpg" };
  }

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mime: "image/png", ext: ".png" };
  }

  // WEBP: RIFF ???? WEBP
  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mime: "image/webp", ext: ".webp" };
  }

  // MP4: байты 4..8 === "ftyp", major brand isom|iso2|mp4*|M4V*
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (/^(isom|iso2|mp4[0-9]|M4V)/.test(brand)) {
      return { mime: "video/mp4", ext: ".mp4" };
    }
    // ftyp, но неизвестный бренд (mov/heic/m4a...) — не пропускаем
    return null;
  }

  // WEBM / MKV: EBML magic 1A 45 DF A3 (принимаем только как webm)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { mime: "video/webm", ext: ".webm" };
  }

  return null;
}

const FORMAT_TO_MIME: Record<string, PhotoMime> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface ImageMeta {
  format: string;
  width: number;
  height: number;
}

/**
 * Проверить изображение через sharp: формат должен быть jpeg/png/webp
 * и совпадать со сниффером; размеры ограничены MAX_IMAGE_DIM.
 * Бросает MediaValidationError (415/422), иначе возвращает метаданные.
 */
export async function parseImageMeta(
  buffer: Buffer,
  sniffedMime: string
): Promise<ImageMeta> {
  let meta: sharp.Metadata | null = null;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    meta = null;
  }

  if (!meta || !meta.format) {
    throw new MediaValidationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Не удалось распознать изображение (битый или неподдерживаемый файл)"
    );
  }

  const mime = FORMAT_TO_MIME[meta.format];
  if (!mime) {
    throw new MediaValidationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      `Формат изображения ${meta.format} не поддерживается (допустимы JPEG, PNG, WebP)`
    );
  }

  if (mime !== sniffedMime) {
    throw new MediaValidationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Содержимое файла не соответствует его MIME-типу"
    );
  }

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1) {
    throw new MediaValidationError(
      422,
      "VALIDATION_FAILED",
      "Не удалось определить размеры изображения"
    );
  }
  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    throw new MediaValidationError(
      422,
      "VALIDATION_FAILED",
      `Изображение слишком большое: ${width}×${height} (максимум ${MAX_IMAGE_DIM}px по стороне)`
    );
  }

  return { format: meta.format, width, height };
}

export interface VideoMeta {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/**
 * Best-effort метаданные видео.
 *  - WEBM: не разбираем глубоко → {null, null, null};
 *  - MP4: ищем moov→mvhd (timescale + duration) и moov→trak→tkhd
 *    (width/height в 16.16 fixed-point, читаем последние 8 байт бокса —
 *    так формат не зависит от версии бокса);
 *  - НИКОГДА не бросает на битом файле (возврат null-полей),
 *    КРОМЕ распознанной длительности > MAX_VIDEO_SECONDS → reject.
 */
export function parseVideoMeta(
  buffer: Buffer,
  sniffedMime: string
): VideoMeta {
  if (sniffedMime === "video/webm") {
    return { width: null, height: null, durationSeconds: null };
  }

  try {
    const parsed = scanMp4(buffer);
    let durationSeconds: number | null = null;
    if (parsed && parsed.timescale > 0 && Number.isFinite(parsed.duration)) {
      durationSeconds = Math.round(parsed.duration / parsed.timescale);
    }
    if (
      durationSeconds !== null &&
      durationSeconds > MAX_VIDEO_SECONDS
    ) {
      throw new MediaValidationError(
        422,
        "VALIDATION_FAILED",
        `Видео длиннее ${MAX_VIDEO_SECONDS} секунд (${durationSeconds} с)`
      );
    }
    return {
      width: parsed?.width ?? null,
      height: parsed?.height ?? null,
      durationSeconds,
    };
  } catch (err) {
    if (err instanceof MediaValidationError) throw err;
    // битый/нестандартный MP4 — не валидируем глубоко
    return { width: null, height: null, durationSeconds: null };
  }
}

interface Mp4Scan {
  timescale: number;
  duration: number;
  width: number | null;
  height: number | null;
}

/**
 * Итератор top-level MP4-боксов c рекурсией в контейнеры moov/trak.
 * [size u32][type ascii4][payload...] ; size===1 → 64-bit largesize;
 * size===0 → бокс тянется до конца контейнера.
 */
function scanMp4(buffer: Buffer): Mp4Scan | null {
  const out: Mp4Scan = { timescale: 0, duration: 0, width: null, height: null };

  const walk = (start: number, end: number, path: string[]): void => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = buffer.readUInt32BE(pos);
      const type = buffer.subarray(pos + 4, pos + 8).toString("latin1");
      let headerSize = 8;

      if (size === 1) {
        if (pos + 16 > end) return;
        const large = buffer.readBigUInt64BE(pos + 8);
        if (large > BigInt(end - pos)) return;
        size = Number(large);
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) return;

      const bodyStart = pos + headerSize;
      const bodyEnd = pos + size;

      if (type === "moov" || type === "trak") {
        walk(bodyStart, bodyEnd, [...path, type]);
      } else if (type === "mvhd" && path.join("/") === "moov") {
        parseMvhd(buffer, bodyStart, bodyEnd, out);
      } else if (type === "tkhd" && path.join("/") === "moov/trak") {
        parseTkhd(buffer, bodyStart, bodyEnd, out);
      }

      pos += size;
    }
  };

  try {
    walk(0, buffer.length, []);
  } catch {
    // недокрученный/битый бокс — отдаём что успели
  }
  return out.timescale > 0 || out.width !== null ? out : null;
}

function parseMvhd(
  buffer: Buffer,
  start: number,
  end: number,
  out: Mp4Scan
): void {
  if (end - start < 4) return;
  const version = buffer[start];
  if (version === 1) {
    if (end - start < 32) return;
    out.timescale = buffer.readUInt32BE(start + 20);
    out.duration = Number(buffer.readBigUInt64BE(start + 24));
  } else {
    if (end - start < 24) return;
    out.timescale = buffer.readUInt32BE(start + 12);
    out.duration = buffer.readUInt32BE(start + 16);
  }
}

function parseTkhd(
  buffer: Buffer,
  start: number,
  end: number,
  out: Mp4Scan
): void {
  // width/height — последние 8 байт бокса, 16.16 fixed-point
  if (end - start < 8) return;
  const w = buffer.readUInt32BE(end - 8) / 65536;
  const h = buffer.readUInt32BE(end - 4) / 65536;
  if (w > 0 && Number.isFinite(w)) out.width = Math.round(w);
  if (h > 0 && Number.isFinite(h)) out.height = Math.round(h);
}
