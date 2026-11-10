/**
 * global-handlers.ts — глобальный страховочный захват ошибок процесса
 * (DEPLOY-01 §3, слой «catch-all»).
 *
 * Зачем: handleRouteError покрывает маршруты, использующие helper;
 * error boundaries покрывают клиент. Ошибки, УСКОЛЬЗНУВШИЕ обоих слоёв
 * (uncaughtException / unhandledRejection в nodejs-рантайме), попадают
 * сюда — единственный оставшийся путь в app_error_events.
 *
 * Правила (§3.3):
 *   • запись — fire-and-forget через storeErrorEvent (он сам не бросает);
 *   • обработчики НИКОГДА не бросают и не await'ят (void);
 *   • двойная установка невозможна (idempotent install);
 *   • процессы не убиваются: решение о рестарте — за оркестратором
 *     (Docker HEALTHCHECK/restart), диагностика только фиксирует.
 *
 * Совместимость: вызывается из src/instrumentation.ts (register()),
 * поэтому импортируется ДИНАМИЧЕСКИ и только в nodejs-рантайме.
 */

import { captureServerError } from "./capture";

const GLOBAL_COMPONENT = "infrastructure";

let installed = false;

/** Идемпотентная установка глобальных обработчиков (только Node.js). */
export function installGlobalErrorHandlers(): void {
  // Клиент / Edge — не наша территория
  if (typeof window !== "undefined") return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (err: unknown) => {
    try {
      captureServerError(err, {
        component: GLOBAL_COMPONENT,
        severity: "critical",
        errorCode: "uncaught_exception",
      });
    } catch {
      // последняя линия обороны: диагностика не должна ронять процесс
      console.warn("[diagnostics] uncaughtException capture failed");
    }
  });

  process.on("unhandledRejection", (reason: unknown) => {
    try {
      captureServerError(reason, {
        component: GLOBAL_COMPONENT,
        severity: "critical",
        errorCode: "unhandled_rejection",
      });
    } catch {
      console.warn("[diagnostics] unhandledRejection capture failed");
    }
  });
}

/** Тест-хук: снять установку (используется ТОЛЬКО в vitest). */
export function __resetGlobalHandlersForTests(): void {
  installed = false;
}

/** Видимость установки (для тестов/проверки). */
export function areGlobalHandlersInstalled(): boolean {
  return installed;
}
