"use client";

/**
 * use-published-cms-page.ts — опубликованные CMS-страницы (cms_pages)
 * для публичных маршрутов /faq, /about, /contacts.
 *
 * Контракт (зеркало use-published-cms.ts, никогда не бросает, не блокирует
 * рендер и не двигает SSR-HTML):
 *   - GET /api/cms/pages — публичный контракт отдаёт ТОЛЬКО status='published'
 *     (фильтр на сервере, черновики — админ-ролям с ?include_drafts=true);
 *   - нет опубликованной страницы (или ошибка/таймаут) → null → вызывающий
 *     рендерит хардкод-фолбэк (разметка 1-в-1 как до появления хука);
 *   - loading === «нет данных» — без скелетонов, ноль визуальных изменений;
 *   - 10s in-memory кэш + дедупликация in-flight запроса.
 */

import { useEffect, useState } from "react";

// ==================== Публичные типы ====================

export interface PublishedCmsPage {
  slug: string;
  title: string;
  description?: string;
  /** Markdown-контент (рендер через react-markdown, сырой HTML не исполняется). */
  content: string;
}

// ==================== Внутреннее ====================

const CACHE_TTL_MS = 10_000;
const MAX_TITLE = 200;
const MAX_DESC = 400;
/** Markdown-страницы бывают длинными; потолок защищает от аномалий БД. */
const MAX_CONTENT = 100_000;
const MAX_SLUG = 100;

const EMPTY: PublishedCmsPage[] = [];

let cache: { pages: PublishedCmsPage[]; expiresAt: number } | null = null;
let inFlight: Promise<PublishedCmsPage[]> | null = null;

function clampText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
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

/** { pages: [...] } → опубликованные страницы (устойчиво к чужому контракту). */
function parsePages(json: unknown): PublishedCmsPage[] {
  const root =
    typeof json === "object" && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;
  const rowsUnknown: unknown = root ? root.pages : null;
  const rows: unknown[] = Array.isArray(rowsUnknown) ? (rowsUnknown as unknown[]) : [];
  const result: PublishedCmsPage[] = [];
  for (const rowUnknown of rows) {
    if (typeof rowUnknown !== "object" || rowUnknown === null) continue;
    const row = rowUnknown as Record<string, unknown>;
    if (row.deleted_at != null) continue;
    if (row.status !== "published") continue; // двойная страховка к серверному фильтру
    const slug = clampText(row.slug, MAX_SLUG);
    const title = clampText(row.title, MAX_TITLE);
    const content = clampText(row.content, MAX_CONTENT);
    if (!slug || !content) continue;
    const page: PublishedCmsPage = { slug, title: title ?? slug, content };
    const description = clampText(row.description, MAX_DESC);
    if (description) page.description = description;
    result.push(page);
  }
  return result;
}

async function fetchPublishedCmsPages(): Promise<PublishedCmsPage[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.pages;
  if (!inFlight) {
    inFlight = (async () => {
      const json = await safeGet("/api/cms/pages");
      const pages = parsePages(json);
      cache = { pages, expiresAt: Date.now() + CACHE_TTL_MS };
      return pages;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// ==================== Hook ====================

/**
 * Опубликованная CMS-страница по slug. null → хардкод-фолбэк (загрузка,
 * ошибка, страницы нет / не опубликована). Fetch стартует только в
 * useEffect на клиенте — гидрации ничего не угрожает.
 */
export function usePublishedCmsPage(slug: string): PublishedCmsPage | null {
  const [page, setPage] = useState<PublishedCmsPage | null>(null);
  useEffect(() => {
    let alive = true;
    fetchPublishedCmsPages()
      .then((pages) => {
        const found = pages.find((p) => p.slug === slug) ?? null;
        if (alive) setPage(found);
      })
      .catch(() => {
        // Никогда не бросаем: ошибка → фолбэк (null уже стоит).
      });
    return () => {
      alive = false;
    };
  }, [slug]);
  return page;
}

/** Диагностический пустой список (не используется в рантайме — для тестов). */
export const EMPTY_PUBLISHED_CMS_PAGES = EMPTY;
