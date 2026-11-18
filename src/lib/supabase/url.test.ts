import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSupabaseServerUrl } from "./url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSupabaseServerUrl", () => {
  it("предпочитает внутренний Kong URL для серверных запросов", () => {
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://supabase-kong:8000/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://conditera.ru/api");

    expect(resolveSupabaseServerUrl()).toBe("http://supabase-kong:8000");
  });

  it("использует публичный Supabase URL, если внутренний адрес не задан", () => {
    vi.stubEnv("SUPABASE_INTERNAL_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://conditera.ru/api");

    expect(resolveSupabaseServerUrl()).toBe("https://conditera.ru/api");
  });

  it("сохраняет локальный URL для разработки", () => {
    vi.stubEnv("SUPABASE_INTERNAL_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:8000");

    expect(resolveSupabaseServerUrl()).toBe("http://127.0.0.1:8000");
  });
});
