"use client";

/**
 * use-published-nav-menu.ts — активные пункты CMS-навигации
 * (cms_nav_menu через GET /api/cms/nav-menu?location=...).
 *
 * Контракт (зеркало use-published-cms.ts): никогда не бросает; нет пунктов
 * (ошибка/пусто) → [] → вызывающий не рендерит CMS-группу (системное меню
 * остаётся). 10s in-memory кэш + дедупликация in-flight запроса.
 */

import { useEffect, useState } from "react";

export interface PublishedNavItem {
  id: string;
  label: string;
  /** Имя SPA-view (catalog, promotions, ...) или внешний http(s)/mailto/tel. */
  url: string;
}

type NavLocation = "header" | "footer" | "mobile";

const CACHE_TTL_MS = 10_000;

const caches = new Map<NavLocation, { items: PublishedNavItem[]; expiresAt: number }>();
const inFlights = new Map<NavLocation, Promise<PublishedNavItem[]>>();

const EMPTY: PublishedNavItem[] = [];

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function clampText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

async function fetchNavItems(location: NavLocation): Promise<PublishedNavItem[]> {
  const cached = caches.get(location);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const inflight = inFlights.get(location);
  if (inflight) return inflight;

  const task = (async () => {
    let json: unknown = null;
    try {
      const res = await fetch(`/api/cms/nav-menu?location=${location}`, { cache: "no-store" });
      if (res.ok) json = await res.json();
    } catch {
      json = null;
    }
    const root = asRecord(json);
    const rowsUnknown: unknown = root ? root.items : null;
    const rows: unknown[] = Array.isArray(rowsUnknown) ? (rowsUnknown as unknown[]) : [];
    const items: PublishedNavItem[] = [];
    for (const row of rows) {
      const r = asRecord(row);
      if (!r || r.is_active === false) continue;
      const id = clampText(r.id, 100);
      const label = clampText(r.label, 100);
      const url = clampText(r.url, 500);
      if (!id || !label || !url) continue;
      items.push({ id, label, url });
    }
    caches.set(location, { items, expiresAt: Date.now() + CACHE_TTL_MS });
    return items;
  })().finally(() => {
    inFlights.delete(location);
  });

  inFlights.set(location, task);
  return task;
}

/**
 * Активные CMS-пункты меню по локации. [] → системный хардкод остаётся
 * (fetch стартует только в useEffect на клиенте).
 */
export function usePublishedNavMenu(location: NavLocation): PublishedNavItem[] {
  const [items, setItems] = useState<PublishedNavItem[]>(EMPTY);
  useEffect(() => {
    let alive = true;
    fetchNavItems(location)
      .then((data) => {
        if (alive && data.length > 0) setItems(data);
      })
      .catch(() => {
        // Никогда не бросаем: ошибка → фолбэк ([] уже стоит).
      });
    return () => {
      alive = false;
    };
  }, [location]);
  return items;
}
