import { describe, it, expect, vi, afterEach } from "vitest";
import { demoSeed, isDemoSeedEnabled } from "./demo-seed";

const MOCK = [{ id: "m1" }, { id: "m2" }];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo-seed gate (production-safe демо-сид)", () => {
  it("development: мок-сид сохраняется (локальная разработка без изменений)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEMO_SEED", "");
    expect(isDemoSeedEnabled()).toBe(true);
    expect(demoSeed(MOCK)).toBe(MOCK); // та же ссылка — нулевая цена в dev
  });

  it("test (vitest): ведёт себя как development — существующие тесты валидны", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_SEED", "");
    expect(isDemoSeedEnabled()).toBe(true);
    expect(demoSeed(MOCK)).toBe(MOCK);
  });

  it("production без флага: пустой массив (честная пустая витрина)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_SEED", "");
    const seeded = demoSeed(MOCK);
    expect(seeded).toEqual([]);
    expect(seeded).not.toBe(MOCK);
    expect(isDemoSeedEnabled()).toBe(false);
  });

  it("production + NEXT_PUBLIC_DEMO_SEED='true': мок-сид сохранён (staging/demo opt-in)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_SEED", "true");
    expect(isDemoSeedEnabled()).toBe(true);
    expect(demoSeed(MOCK)).toBe(MOCK);
  });

  it("production + флаг != 'true' (false/1/да): всё ещё пусто — строгое сравнение", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_SEED", "false");
    expect(demoSeed(MOCK)).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_DEMO_SEED", "1");
    expect(demoSeed(MOCK)).toEqual([]);
  });
});
