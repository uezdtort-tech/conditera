"use client";

/**
 * use-published-home-blocks.ts — опубликованные CMS-блоки секций главной
 * (cms_sections + cms_section_blocks через GET /api/cms/blocks).
 *
 * Контракт (зеркало use-published-cms.ts): никогда не бросает, не блокирует
 * рендер; нет блоков (ошибка/пусто) → пустая map → вызывающий рендерит
 * хардкод-фолбэк. 10s in-memory кэш + дедупликация in-flight запроса.
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function clampText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

async function fetchBlocksBySection(): Promise<Record<string, PublishedHomeBlock[]>> {
  if (cache && cache.expiresAt > Date.now()) return cache.bySection;
  if (!inFlight) {
    inFlight = (async () => {
      let json: unknown = null;
      try {
        const res = await fetch("/api/cms/blocks", { cache: "no-store" });
        if (res.ok) json = await res.json();
      } catch {
        json = null;
      }
      const root = asRecord(json);
      const sectionsUnknown: unknown = root ? root.sections : null;
      const sections: unknown[] = Array.isArray(sectionsUnknown) ? (sectionsUnknown as unknown[]) : [];
      const bySection: Record<string, PublishedHomeBlock[]> = {};
      for (const s of sections) {
        const rec = asRecord(s);
        const slug = clampText(rec?.slug, 60);
        const blocksUnknown: unknown = rec ? rec.blocks : null;
        const blocks: unknown[] = Array.isArray(blocksUnknown) ? (blocksUnknown as unknown[]) : [];
        if (!slug) continue;
        const items: PublishedHomeBlock[] = [];
        for (const b of blocks) {
          const r = asRecord(b);
          if (!r || r.isActive === false) continue;
          items.push({
            id: clampText(r.id, 100) ?? "",
            title: clampText(r.title, 200),
            subtitle: clampText(r.subtitle, 400),
            text: clampText(r.content ?? r.text, 1000),
            image: clampText(r.image, 2048),
            link: clampText(r.link, 500),
            linkText: clampText(r.linkText, 200),
          });
        }
        if (items.length > 0) bySection[slug] = items;
      }
      cache = { bySection, expiresAt: Date.now() + CACHE_TTL_MS };
      return bySection;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Опубликованные CMS-блоки по секциям: { advantages: [...], steps: [...] }.
 * Пустая map / отсутствие секции → хардкод-фолбэк (fetch в useEffect).
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
        // Никогда не бросаем: ошибка → фолбэк (EMPTY уже стоит).
      });
    return () => {
      alive = false;
    };
  }, []);
  return bySection;
}
