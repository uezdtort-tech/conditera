"use client";

/**
 * Публичные CMS-блоки главной страницы.
 * Источник истины — public GET /api/cms/home-blocks?public=true,
 * возвращающий строки public.cms_home_blocks в snake_case.
 * Ошибка или пустая таблица не блокируют рендер: страница использует
 * встроенный контент как безопасный fallback.
 */

import { useEffect, useState } from "react";

export interface PublishedHomeBlock {
  id: string;
  title?: string;
  subtitle?: string;
  text?: string;
  image?: string;
  link?: string;
  linkText?: string;
}

const CACHE_TTL_MS = 10_000;

let cache: { bySection: Record<string, PublishedHomeBlock[]>; expiresAt: number } | null = null;
let inFlight: Promise<Record<string, PublishedHomeBlock[]>> | null = null;

const EMPTY: Record<string, PublishedHomeBlock[]> = {};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
}

/** Преобразует реальный API-контракт cms_home_blocks в map по секциям. */
export function groupPublishedHomeBlocks(input: unknown): Record<string, PublishedHomeBlock[]> {
  const bySection: Record<string, PublishedHomeBlock[]> = Object.create(null) as Record<string, PublishedHomeBlock[]>;
  if (!Array.isArray(input)) return bySection;

  for (const value of input) {
    const row = asRecord(value);
    const section = clampText(row?.section, 60);
    const id = clampText(row?.id, 100);
    if (!row || !section || !id || row.is_active !== true) continue;

    const block: PublishedHomeBlock = {
      id,
      title: clampText(row.title, 200),
      subtitle: clampText(row.subtitle, 400),
      text: clampText(row.content, 1000),
      image: clampText(row.image_url, 2048),
      link: clampText(row.link_url, 2048),
      linkText: clampText(row.link_text, 200),
    };
    (bySection[section] ??= []).push(block);
  }

  return bySection;
}

async function fetchBlocksBySection(): Promise<Record<string, PublishedHomeBlock[]>> {
  if (cache && cache.expiresAt > Date.now()) return cache.bySection;
  if (!inFlight) {
    inFlight = (async () => {
      let json: unknown = null;
      try {
        const response = await fetch("/api/cms/home-blocks?public=true", { cache: "no-store" });
        if (response.ok) json = await response.json();
      } catch {
        json = null;
      }
      const root = asRecord(json);
      const bySection = groupPublishedHomeBlocks(root?.blocks);
      cache = { bySection, expiresAt: Date.now() + CACHE_TTL_MS };
      return bySection;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Опубликованные блоки по секциям: { advantages: [...], steps: [...] }.
 * При пустом результате вызывающая страница сохраняет встроенный fallback.
 */
export function usePublishedHomeBlocks(): Record<string, PublishedHomeBlock[]> {
  const [bySection, setBySection] = useState<Record<string, PublishedHomeBlock[]>>(EMPTY);
  useEffect(() => {
    let alive = true;
    fetchBlocksBySection()
      .then((data) => {
        if (alive && Object.keys(data).length > 0) setBySection(data);
      })
      .catch(() => {
        // Ошибка API не должна ломать публичную главную.
      });
    return () => {
      alive = false;
    };
  }, []);
  return bySection;
}
