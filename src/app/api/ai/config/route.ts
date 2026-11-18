/**
 * GET /api/ai/config — эффективная конфигурация AI-агента (admin-only).
 *
 * Вынесено из кода в env (см. src/lib/ai-config.ts) по поручению владельца;
 * этот эндпоинт позволяет на локальной машине увидеть, какие параметры
 * реально применяются: порядок провайдеров, модели, temperature, max_tokens,
 * таймауты и доступность провайдеров.
 *
 * Ничего секретного не раскрывает: ключи API/токены в ответ не попадают —
 * только URL-флаг наличия, имена моделей и числовые параметры.
 *
 * Query-параметры:
 *   ?probe=1 — дополнительно проверить доступность провайдеров
 *              (быстрая проба Ollama /api/tags, 1.5 c; наличие модуля z-ai).
 *
 * Auth: сессия с ролью ADMIN или SUPER_ADMIN (requireAdmin).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAiAgentConfig, AI_CONFIG_KEYS, AI_DEFAULTS } from "@/lib/ai-config";
import { requireAdmin } from "@/lib/supabase/auth";

export const runtime = "nodejs";

/** Роуты-потребители chatComplete (для справки владельцу/админу) */
const CONSUMERS = [
  "/api/ai/search",
  "/api/ai/compare",
  "/api/ai/ask",
  "/api/ai-assistant/chat",
  "/api/ai-cake-finder",
] as const;

interface ProviderAvailability {
  configured: boolean;
  reachable: boolean | null; // null = проба не выполнялась (без ?probe=1)
  detail?: string;
}

async function probeOllama(baseUrl: string): Promise<ProviderAvailability> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    return {
      configured: true,
      reachable: res.ok,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { configured: true, reachable: false, detail: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Требуется роль ADMIN или SUPER_ADMIN" },
      { status: 401 }
    );
  }

  const cfg = getAiAgentConfig();
  const probe = new URL(request.url).searchParams.get("probe") === "1";

  const availability: Record<"ollama" | "zai", ProviderAvailability> = {
    ollama: cfg.ollama.baseUrl
      ? { configured: true, reachable: null }
      : { configured: false, reachable: false, detail: "OLLAMA_BASE_URL не задан" },
    zai: { configured: true, reachable: null },
  };

  // Реальные пробы — только при ?probe=1 (чтобы обычный GET не делал сетевых вызовов)
  if (probe && cfg.ollama.baseUrl) {
    availability.ollama = await probeOllama(cfg.ollama.baseUrl);
  }
  if (probe) {
    try {
      const mod = (await import("z-ai-web-dev-sdk").catch(() => null)) as any;
      availability.zai = {
        configured: true,
        reachable: Boolean(mod && (mod.create || mod.default?.create)),
      };
    } catch {
      availability.zai = { configured: true, reachable: false, detail: "модуль недоступен" };
    }
  }

  return NextResponse.json({
    config: cfg,
    availability,
    envKeys: AI_CONFIG_KEYS,
    defaults: AI_DEFAULTS,
    consumers: CONSUMERS,
    docs: "src/lib/ai-config.ts — полный список переменных окружения",
  });
}
