/**
 * Гейт demo/mock-сида (production-safe витрина).
 *
 * Проблема (аудит): Zustand-store засеивается MOCK_*-данными безусловно.
 * В dev это оживляет демо, но в production-деплое с пустой/недоступной БД
 * витрина молча показывает фейковый каталог, товары которого 404-ят на
 * чекауте (LiveProductsHydrator подменяет товары, только если /api/products
 * вернул строки).
 *
 * Контракт:
 *   • development / test (vitest) — мок-сид сохраняется. NODE_ENV='test'
 *     приравнен к development, чтобы существующие тесты (store.test.ts),
 *     рассчитанные на засеянные данные, оставались валидными.
 *   • production — сид ПУСТОЙ по умолчанию: честная пустая витрина вместо
 *     фейкового каталога.
 *   • production + NEXT_PUBLIC_DEMO_SEED='true' — мок-сид возвращается
 *     (явный opt-in для staging/demo-стендов).
 *
 * NB: модуль используется в клиентском коде ('use client' store) —
 * NEXT_PUBLIC_* инлайнится на этапе сборки, NODE_ENV заменяется DefinePlugin:
 * оба механизма корректны на клиенте.
 */

/** Ленивая проверка (читает env на каждый вызов — тестируемо через vi.stubEnv). */
export function isDemoSeedEnabled(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  // 'test' (vitest) ведёт себя как 'development': сиды сохранены.
  return nodeEnv !== "production" || process.env.NEXT_PUBLIC_DEMO_SEED === "true";
}

/** Снимок флага на момент загрузки модуля (для диагностики/статических проверок). */
export const DEMO_SEED_ENABLED = isDemoSeedEnabled();

/**
 * Обёртка над mock-массивами в initial state стора:
 * возвращает мок в dev/test (и в production при NEXT_PUBLIC_DEMO_SEED='true'),
 * иначе — пустой массив. Форму стора и действия не меняет — только значения.
 */
export function demoSeed<T>(mock: T[]): T[] {
  return isDemoSeedEnabled() ? mock : [];
}
