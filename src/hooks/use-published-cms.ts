"use client";

/**
 * use-published-cms.ts — опубликованный CMS-контент для публичных страниц
 * (backlog ZV31-001, задача Z31-3-d).
 *
 * Публичные страницы должны читать контент, опубликованный админом, а не
 * admin-write-only стор. Публичный read-only контракт кодовой базы:
 *   - GET /api/cms/settings → { settings: [{ key, value, category, ... }] }
 *     (таблица site_settings, key-value);
 *   - GET /api/cms/banners  → { banners: [{ id, title, image_url, link_url,
 *     position, text, is_active, sort_order, starts_at, ends_at, ... }] }
 *     (cms_banners; фильтр is_active=true и сортировка sort_order asc
 *     применяются на сервере — это и есть «published/active»).
 *
 * Контракт (никогда не бросает, никогда не блокирует рендер):
 *   - пока идёт загрузка / при ошибке / при пустом CMS →
 *     { hero: null, banners: [] } → вызывающий рендерит хардкод-фолбэк
 *     (разметка 1-в-1 как до появления этого хука);
 *   - loading === «нет данных» (без скелетонов: ноль визуальных изменений,
 *     пока опубликованный контент реально не придёт);
 *   - 10s in-memory кэш + дедупликация in-flight запроса, чтобы SPA-переходы
 *     между view не устраивали refetch-штормов.
 *
 * Hero читается из key-value настроек (админ добавляет их через «Настройки
 * сайта» — строки по ключам): hero_title / hero_subtitle / hero_cta_label /
 * hero_cta_href / hero_image (плюс алиасы home_hero_*). Нет ключей →
 * hero = null → хардкод-герой главной.
 *
 * Баннеры фильтруются на клиенте: (а) позиции домашней ленты — «top»,
 * «hero», «home_hero» (оба словаря кодовой базы: админский UI и миграция
 * 0005), (б) окно показа starts_at/ends_at — как в useCmsBanners().
 */

import { useEffect, useState } from "react";

// ==================== Публичные типы ====================

export interface PublishedHeroCms {
  title: string;
  subtitle: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageUrl?: string;
}

export interface PublishedBannerCms {
  id: string;
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  href?: string;
  sortOrder: number;
}

export interface PublishedHomeCms {
  hero: PublishedHeroCms | null;
  banners: PublishedBannerCms[];
}

// ==================== Внутреннее ====================

const CACHE_TTL_MS = 10_000;
const MAX_TITLE = 200;
const MAX_SUBTITLE = 400;
const MAX_URL = 2048;

/** Позиции баннеров домашней ленты (админский UI + миграция 0005). */
const HOME_STRIP_POSITIONS = new Set(["top", "hero", "home_hero"]);

/** Ключи hero-блока в key-value настройках (site_settings). */
const HERO_TITLE_KEYS = ["hero_title", "home_hero_title"] as const;
const HERO_SUBTITLE_KEYS = ["hero_subtitle", "home_hero_subtitle", "hero_description"] as const;
const HERO_CTA_LABEL_KEYS = ["hero_cta_label", "hero_cta_text", "home_hero_cta_label"] as const;
const HERO_CTA_HREF_KEYS = ["hero_cta_href", "hero_cta_link", "home_hero_cta_href", "hero_link"] as const;
const HERO_IMAGE_KEYS = ["hero_image", "hero_image_url", "home_hero_image"] as const;

const EMPTY_CMS: PublishedHomeCms = { hero: null, banners: [] };

let cache: { data: PublishedHomeCms; expiresAt: number } | null = null;
let inFlight: Promise<PublishedHomeCms> | null = null;

/** unknown → object (или null), без any. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Обрезка строки до max символов; пустое/не-строковое → null. */
function clampText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function clampUrl(v: unknown): string | null {
  return clampText(v, MAX_URL);
}

/** GET, который никогда не бросает: сеть/HTTP-статус/парсинг → null. */
async function safeGet(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** { settings: [...] } → плоская map key→value (первое вхождение побеждает). */
function parseSettingsMap(json: unknown): Record<string, string> {
  const root = asRecord(json);
  const rowsUnknown: unknown = root ? root.settings : null;
  const rows: unknown[] = Array.isArray(rowsUnknown) ? (rowsUnknown as unknown[]) : [];
  const map: Record<string, string> = {};
  for (const rowUnknown of rows) {
    const row = asRecord(rowUnknown);
    if (!row) continue;
    const key = clampText(row.key, 200);
    if (!key || map[key] !== undefined) continue;
    if (typeof row.value === "string") map[key] = row.value;
    else if (typeof row.value === "number" || typeof row.value === "boolean") {
      map[key] = String(row.value);
    }
  }
  return map;
}

function firstSetting(
  map: Record<string, string>,
  keys: readonly string[],
  max: number
): string | null {
  for (const key of keys) {
    const clamped = clampText(map[key], max);
    if (clamped) return clamped;
  }
  return null;
}

function buildHero(map: Record<string, string>): PublishedHeroCms | null {
  const title = firstSetting(map, HERO_TITLE_KEYS, MAX_TITLE);
  // Hero включается ТОЛЬКО наличием CMS-заголовка — иначе фолбэк на хардкод.
  if (!title) return null;
  const hero: PublishedHeroCms = {
    title,
    subtitle: firstSetting(map, HERO_SUBTITLE_KEYS, MAX_SUBTITLE) ?? "",
  };
  const ctaLabel = firstSetting(map, HERO_CTA_LABEL_KEYS, MAX_TITLE);
  const ctaHref = firstSetting(map, HERO_CTA_HREF_KEYS, MAX_URL);
  if (ctaLabel && ctaHref) {
    hero.ctaLabel = ctaLabel;
    hero.ctaHref = ctaHref;
  }
  const imageUrl = firstSetting(map, HERO_IMAGE_KEYS, MAX_URL);
  if (imageUrl) hero.imageUrl = imageUrl;
  return hero;
}

/** Окно показа баннера: null/невалидная дата → окно открыто (как в useCmsBanners). */
function displayWindowOpen(row: Record<string, unknown>, now: number): boolean {
  const startsRaw = row.starts_at ?? row.start_at;
  const endsRaw = row.ends_at ?? row.end_at;
  const starts = typeof startsRaw === "string" ? Date.parse(startsRaw) : NaN;
  const ends = typeof endsRaw === "string" ? Date.parse(endsRaw) : NaN;
  if (Number.isFinite(starts) && starts > now) return false;
  if (Number.isFinite(ends) && ends < now) return false;
  return true;
}

function parseBanners(json: unknown): PublishedBannerCms[] {
  const root = asRecord(json);
  const rowsUnknown: unknown = root ? root.banners : null;
  const rows: unknown[] = Array.isArray(rowsUnknown) ? (rowsUnknown as unknown[]) : [];
  const now = Date.now();
  const result: PublishedBannerCms[] = [];
  for (const rowUnknown of rows) {
    const row = asRecord(rowUnknown);
    if (!row) continue;
    // Route уже фильтрует is_active=true, но остаёмся устойчивыми к контракту.
    if (row.is_active === false) continue;
    const position = typeof row.position === "string" ? row.position : "";
    if (!HOME_STRIP_POSITIONS.has(position)) continue;
    if (!displayWindowOpen(row, now)) continue;
    const id = clampText(row.id, 200);
    if (!id) continue;
    result.push({
      id,
      title: clampText(row.title, MAX_TITLE) ?? undefined,
      subtitle:
        clampText(row.text, MAX_SUBTITLE) ??
        clampText(row.subtitle, MAX_SUBTITLE) ??
        undefined,
      imageUrl: clampUrl(row.image_url) ?? undefined,
      href: clampUrl(row.link_url) ?? undefined,
      sortOrder:
        typeof row.sort_order === "number" && Number.isFinite(row.sort_order)
          ? row.sort_order
          : 0,
    });
  }
  result.sort((a, b) => a.sortOrder - b.sortOrder); // Array#sort стабилен
  return result;
}

async function fetchPublishedHomeCms(): Promise<PublishedHomeCms> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  if (!inFlight) {
    inFlight = (async () => {
      const [settingsJson, bannersJson] = await Promise.all([
        safeGet("/api/cms/settings"),
        safeGet("/api/cms/banners"),
      ]);
      const data: PublishedHomeCms = {
        hero: buildHero(parseSettingsMap(settingsJson)),
        banners: parseBanners(bannersJson),
      };
      cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// ==================== Hook ====================

/**
 * Опубликованный CMS-контент главной. Пока данные не загружены (или их нет /
 * ошибка) возвращает { hero: null, banners: [] } — рендер идёт по
 * хардкод-фолбэку, SSR-HTML не меняется, гидрации ничего не угрожает
 * (fetch стартует только в useEffect, на клиенте).
 */
export function usePublishedHomeCms(): PublishedHomeCms {
  const [data, setData] = useState<PublishedHomeCms>(EMPTY_CMS);
  useEffect(() => {
    let alive = true;
    fetchPublishedHomeCms()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        // Никогда не бросаем: любая ошибка → фолбэк (EMPTY_CMS уже стоит).
      });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

// ==================== Помощники рендера ссылок из CMS ====================

/** Внешняя ссылка (http/https/protocol-relative/mailto/tel) — рендерим <a>. */
export function isExternalCmsHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href) || /^(mailto:|tel:)/i.test(href);
}

/**
 * Внутренняя CMS-ссылка → имя SPA-view для store.navigate (навигация
 * кодовой базы — view-имена вроде "catalog"/"promotions"; ведущий "/"
 * допустим и срезается).
 */
export function cmsInternalView(href: string): string {
  return href.replace(/^\/+/, "");
}
