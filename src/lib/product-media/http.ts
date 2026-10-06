/**
 * product-media/http.ts — общие помощники API-роутов товарных медиа (Task 2-b).
 *
 * Контракт ошибок: { error: "CODE", message: "..." } со статусами
 *   401 UNAUTHORIZED | 403 FORBIDDEN | 404 NOT_FOUND | 409 *_LIMIT_REACHED |
 *   413 PAYLOAD_TOO_LARGE | 415 UNSUPPORTED_MEDIA_TYPE | 422 VALIDATION_FAILED |
 *   500 INTERNAL_ERROR
 *
 * Мутации клиент шлёт через csrfFetch (double-submit x-csrf-token) —
 * на сервере проверка CSRF не нужна (middleware/proxy уже отсёк).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasAnyRole } from "@/lib/role-guards";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MODERATOR_ROLES = ["MODERATOR", "ADMIN", "SUPER_ADMIN"] as const;
export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

/** MODERATOR | ADMIN | SUPER_ADMIN */
export async function hasModeratorRole(userId: string): Promise<boolean> {
  return hasAnyRole(userId, [...MODERATOR_ROLES]);
}

/** ADMIN | SUPER_ADMIN (без MODERATOR) */
export async function hasAdminRole(userId: string): Promise<boolean> {
  return hasAnyRole(userId, [...ADMIN_ROLES]);
}

export interface ProductRef {
  id: string;
  slug: string;
  title: string;
  status: string;
  confectioner_id: string;
  deleted_at: string | null;
}

/**
 * Резолв товара по UUID или slug (как в /api/products/[id], Task 3-a).
 * null → 404.
 */
export async function resolveProduct(
  idOrSlug: string
): Promise<ProductRef | null> {
  const byUuid = UUID_RE.test(idOrSlug);
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, slug, title, status, confectioner_id, deleted_at")
    .eq(byUuid ? "id" : "slug", idOrSlug)
    .maybeSingle();
  if (error) {
    console.error("[product-media] resolveProduct query error:", error.message);
    return null;
  }
  return (data as ProductRef | null) ?? null;
}

export interface MediaRow {
  [key: string]: unknown;
  id: string;
  product_id: string;
  media_type: "photo" | "video";
  storage_path: string;
  original_filename: string | null;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
  is_cover: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  moderated_by: string | null;
  moderated_at: string | null;
  moderation_comment: string | null;
  created_at: string;
  updated_at: string;
}

export function mediaUrl(row: Pick<MediaRow, "id">): string {
  return `/api/product-media/${row.id}`;
}

/** pg-совместимые типы строк для count/returning-запросов. */
export interface CountRow {
  [key: string]: unknown;
  n: number;
}
export interface IdRow {
  [key: string]: unknown;
  id: string;
}

/** Строка БД + url — стандартный элемент ответов media-роутов. */
export function withUrl(row: MediaRow): MediaRow & { url: string } {
  return { ...row, url: mediaUrl(row) };
}

/** Оригинальное имя файла: срезаем управляющие символы, ограничиваем 255. */
export function sanitizeOriginalFilename(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 255);
}
