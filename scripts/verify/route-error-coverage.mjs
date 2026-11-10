#!/usr/bin/env node
/**
 * scripts/verify/route-error-coverage.mjs — CI-гвард охвата единой
 * регистрацией ошибок (DEPLOY-01 §3).
 *
 * Для каждого route.ts из CORE_ROUTES (закрытый список критичного
 * бизнес-периметра: заказы/платежи/чат/склад/рецепты/выплаты/медиа)
 * проверяется, что файл использует handleRouteError ИЛИ
 * captureServerError. Маршрут без них = FAIL (5xx не попадёт в
 * app_error_events → инцидент не создастся →闭环 сломан).
 *
 * Исключения: EXEMPT (файлы не существуют / вне периметра). Загрузочные
 * маршруты upload/* — под защитой red-line и НЕ входят в список для
 * правок (protected paths), но включены через captureServerError
 * в своих тестах отдельно.
 *
 * Запуск: node scripts/verify/route-error-coverage.mjs
 * Exit: 0 — все покрыты; 1 — есть непокрытые (CI fail).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Критичный бизнес-периметр (DEPLOY-01 §6 п.14 — бизнес-регрессия). */
const CORE_ROUTES = [
  // Заказы (жизненный цикл)
  "src/app/api/orders/route.ts",
  "src/app/api/orders/availability/route.ts",
  "src/app/api/orders/[id]/route.ts",
  "src/app/api/orders/[id]/accept/route.ts",
  "src/app/api/orders/[id]/cancel/route.ts",
  "src/app/api/orders/[id]/complete/route.ts",
  "src/app/api/orders/[id]/ready/route.ts",
  "src/app/api/orders/[id]/assign/route.ts",
  "src/app/api/orders/[id]/reassign/route.ts",
  "src/app/api/orders/[id]/repeat/route.ts",
  "src/app/api/orders/[id]/timeline/route.ts",
  "src/app/api/orders/[id]/lifecycle/route.ts",
  "src/app/api/orders/[id]/media/route.ts",
  "src/app/api/orders/[id]/handoff/route.ts",
  "src/app/api/orders/[id]/breakdown/route.ts",
  "src/app/api/orders/[id]/purchase-draft/route.ts",
  "src/app/api/orders/[id]/production/start/route.ts",
  "src/app/api/orders/[id]/production/complete/route.ts",
  "src/app/api/orders/[id]/acceptance-check/route.ts",
  "src/app/api/orders/[id]/capacity/route.ts", // Z-v19 §6: добавлен в периметр (был пропущен, 5xx не регистрировался)
  // Платежи (деньги)
  "src/app/api/payment/create/route.ts",
  "src/app/api/payment/webhook/route.ts",
  "src/app/api/payment/refund/route.ts",
  "src/app/api/payouts/request/route.ts",
  // Чат (приватные коммуникации)
  "src/app/api/chat/rooms/route.ts",
  "src/app/api/chat/rooms/[id]/route.ts",
  "src/app/api/chat/rooms/[id]/messages/route.ts",
  "src/app/api/chat/rooms/[id]/read/route.ts",
  "src/app/api/chat/rooms/[id]/bot-message/route.ts",
  "src/app/api/chat/auto-reply/route.ts",
  "src/app/api/chat/bot-trigger/route.ts",
  // Склад
  "src/app/api/inventory/items/route.ts",
  "src/app/api/inventory/movements/route.ts",
  "src/app/api/inventory/write-off/route.ts",
  // Рецепты (включая платную витрину)
  "src/app/api/recipes/route.ts",
  "src/app/api/recipes/[id]/route.ts",
  "src/app/api/recipes/[id]/publish/route.ts",
  "src/app/api/recipes/[id]/accept/route.ts",
  "src/app/api/recipes/[id]/acceptances/route.ts",
  "src/app/api/recipes/[id]/rights-confirm/route.ts",
  "src/app/api/recipes/[id]/scale/route.ts",
  "src/app/api/recipes/[id]/versions/route.ts",
  "src/app/api/recipes/marketplace/route.ts",
  "src/app/api/recipes/marketplace/[id]/route.ts",
  "src/app/api/recipes/marketplace/[id]/purchase/route.ts",
  "src/app/api/recipes/purchases/route.ts",
  // Медиа заказа
  "src/app/api/order-media/route.ts",
  "src/app/api/order-media/[mediaId]/route.ts",
];

/** Файлы, отсутствующие в репозитории (список сверяется с диском). */
const KNOWN_ABSENT = new Set([
  // order-media имеет только динамический подмаршрут [mediaId] (загрузка —
  // через orders/[id]/media); корневого route.ts в репозитории нет.
  "src/app/api/order-media/route.ts",
]);

function isCoreRoutePresent(rel) {
  return existsSync(join(ROOT, rel));
}

/**
 * Z-v19 §6 (hardening): проверка ВЫЗОВА, а не упоминания. Старая проверка
 * source.includes("handleRouteError") давала false positive: строка-импорт
 * `import { handleRouteError } from ...` проходила гвард без единого вызова
 * (дефект найден верификацией на src/app/api/orders/route.ts). Комментарии
 * вырезаются, требуется синтаксис вызова `handleRouteError(`.
 */
function usesErrorCapture(source) {
  // вырезаем блочные и строчные комментарии, сохраняя переводы строк
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
  return (
    /handleRouteError\s*\(/.test(stripped) ||
    /captureServerError\s*\(/.test(stripped) ||
    /captureDependencyError\s*\(/.test(stripped)
  );
}

let missing = [];
let checked = 0;

for (const rel of CORE_ROUTES) {
  if (!isCoreRoutePresent(rel)) {
    if (!KNOWN_ABSENT.has(rel)) {
      missing.push(`${rel} — файл отсутствует (обновите список или восстановите файл)`);
    }
    continue;
  }
  checked += 1;
  const src = readFileSync(join(ROOT, rel), "utf8");
  if (!usesErrorCapture(src)) {
    missing.push(`${rel} — нет handleRouteError/captureServerError (5xx не попадёт в app_error_events)`);
  }
}

console.log(`route-error-coverage: checked=${checked}/${CORE_ROUTES.length}`);

if (missing.length > 0) {
  console.error("\n❌ CORE ROUTES WITHOUT UNIFIED ERROR CAPTURE:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error("\nПравило: catch → return handleRouteError(e, { route, component }).");
  console.error("Подробности: docs/operations/ERROR_TRACKING.md §3.");
  process.exit(1);
}

console.log("✅ все маршруты критичного периметра используют единую регистрацию ошибок");
